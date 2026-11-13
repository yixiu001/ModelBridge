import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { beginLogin, acceptCallback, validateIdToken } from '../src/auth.mjs';

test('registration uses fresh PKCE and nonce, stable host and official route', () => {
  const a = beginLogin({ hostId: 'urn:uuid:test', redirectUri: 'http://127.0.0.1:1234/auth/callback' });
  const b = beginLogin({ hostId: 'urn:uuid:test', redirectUri: 'http://127.0.0.1:1234/auth/callback' });
  const u = new URL(a.url);
  assert.equal(u.origin, 'https://auth.openai.com');
  assert.equal(u.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(u.searchParams.get('agent_name_hint'), 'ModelBridge');
  assert.equal(u.searchParams.get('ext_agent_host_id'), 'urn:uuid:test');
  assert.equal(u.searchParams.get('code_challenge'), createHash('sha256').update(a.verifier).digest('base64url'));
  assert.match(u.searchParams.get('scope'), /chatgpt.tokens.use.direct/);
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.nonce, b.nonce);
});

test('callback validates state, expiry and issued client before accepting code', () => {
  const p = beginLogin({ hostId: 'urn:uuid:test', redirectUri: 'http://127.0.0.1:1234/auth/callback' });
  const query = new URLSearchParams({ state: p.state, code: 'secret', client_id: 'oaiapp_test' });
  assert.equal(acceptCallback(p, query).clientId, 'oaiapp_test');
  assert.throws(() => acceptCallback(p, query), /used/);
  const q = beginLogin({ hostId: 'h', redirectUri: 'http://127.0.0.1:1234/auth/callback' });
  assert.throws(() => acceptCallback(q, query), /state/);
  assert.throws(() => acceptCallback({ ...q, expiresAt: 0 }, query), /expired/);
  assert.throws(() => acceptCallback(q, new URLSearchParams({ state: q.state, code: 'c' })), /client/);
});

test('returning registration cannot be replaced by a callback client', () => {
  const p = beginLogin({ hostId: 'h', redirectUri: 'http://127.0.0.1:1234/auth/callback', account: { client_id: 'oaiapp_saved', subject: 's' } });
  assert.equal(new URL(p.url).searchParams.get('client_id'), 'oaiapp_saved');
  assert.equal(new URL(p.url).searchParams.has('agent_name_hint'), false);
  assert.throws(() => acceptCallback(p, new URLSearchParams({ state: p.state, code: 'c', client_id: 'oaiapp_other' })), /client/);
});

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256', use: 'sig' }] };
function token(overrides = {}, header = {}) {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test', ...header })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: 'oaiapp_test', sub: 'account', nonce: 'nonce', exp: Math.floor(Date.now()/1000)+300, ...overrides })).toString('base64url');
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
}
test('ID token signature and identity binding are verified', () => {
  const options = { jwks, clientId: 'oaiapp_test', nonce: 'nonce' };
  assert.equal(validateIdToken(token(), options).sub, 'account');
  for (const changes of [{ iss: 'https://evil.test' }, { aud: 'other' }, { nonce: 'wrong' }, { exp: 1 }, { sub: '' }, { nbf: 9999999999 }]) {
    assert.throws(() => validateIdToken(token(changes), options));
  }
  assert.throws(() => validateIdToken(token({}, { alg: 'none' }), options));
  const broken = token().split('.'); broken[2] = 'AA';
  assert.throws(() => validateIdToken(broken.join('.'), options));
  assert.throws(() => validateIdToken(token(), { ...options, expectedSubject: 'other' }));
});
