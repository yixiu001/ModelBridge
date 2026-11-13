import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BridgeService } from '../src/service.mjs';

test('malformed chat input cannot leave an active gateway lock behind',async()=>{
  const service=new BridgeService({dataDir:tmpdir(),fetcher:async()=>{throw new Error('must not fetch');}});
  for(const body of [null,[],{messages:{}},{messages:[null]},{messages:[],tools:{}}]) {
    await assert.rejects(()=>service.chat(body),/invalid_chat_request/);
    assert.equal(service.gatewayActive,0);
  }
});

test('registration persists validated grant; refresh serializes; catalog and probes keep exact model', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'modelbridge-service-'));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let pending, refreshCount = 0, inferCount = 0;
  const fetched = [];
  const fetcher = async (url, options={}) => {
    fetched.push(String(url));
    if (String(url).endsWith('/openid-configuration')) return Response.json({ issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/.well-known/jwks.json', token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token' });
    if (String(url).endsWith('/jwks.json')) return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), alg: 'RS256', kid: 'k' }] });
    if (String(url).endsWith('/oauth/token')) {
      const fields = new URLSearchParams(options.body);
      assert.equal(fields.get('client_id'), 'oaiapp_test');
      if (fields.get('grant_type') === 'refresh_token') { refreshCount++; return Response.json({ access_token: 'new-access', refresh_token: 'rotated', token_type: 'Bearer', expires_in: 3600 }); }
      const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k' })).toString('base64url');
      const p = Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: 'oaiapp_test', sub: 'subject', nonce: pending.nonce, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url');
      return Response.json({ id_token: `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`, access_token: 'initial', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 1, scope: 'openid resource.invoke chatgpt.tokens.use.direct' });
    }
    if (String(url).endsWith('/models')) {
      assert.equal(options.headers.Authorization, 'Bearer new-access');
      return Response.json({ models: [{ slug: 'future-model', display_name: 'Future', visibility: 'list' }, { slug: 'another', visibility: 'list' }] });
    }
    if (String(url).endsWith('/responses')) {
      inferCount++;
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'future-model');
      assert.equal(body.store, false); assert.equal(body.stream, true);
      return new Response('data: '+JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'MODELBRIDGE_OK' }] }] } })+'\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }
    throw new Error('unexpected fetch');
  };
  try {
    const service = new BridgeService({ dataDir: dir, fetcher });
    await service.init();
    const url = service.startLogin('http://127.0.0.1:1455/auth/callback');
    pending = { nonce: new URL(url).searchParams.get('nonce') };
    await service.finishLogin(new URLSearchParams({ state: new URL(url).searchParams.get('state'), code: 'code', client_id: 'oaiapp_test' }));
    await Promise.all([service.accessToken(),service.accessToken()]);
    assert.equal(refreshCount, 1);
    await service.refreshCatalog();
    assert.equal(service.status().models.length, 2);
    await assert.rejects(() => service.verify('missing', 'text'), /unknown model/);
    assert.equal(inferCount, 0);
    const report = await service.verify('future-model', 'text');
    assert.equal(report.status, 'passed');
    assert.equal(service.status().models[1].verification, 'unverified');
    const safe = JSON.stringify(service.status());
    for (const secret of ['new-access','rotated','initial','refresh_token','id_token']) assert.equal(safe.includes(secret), false);
    const restored = new BridgeService({ dataDir: dir, fetcher }); await restored.init();
    assert.equal(restored.status().account.connected, true);
    assert.equal(restored.status().models.length, 0); // Fresh discovery after restart, no stale permission assumptions.
    assert.equal(restored.status().reports.length, 1);
    await restored.refreshCatalog();
    assert.equal(restored.status().models[0].verification, 'partially_verified');
    assert.equal(restored.status().models[0].checks.text.status, 'passed');
    assert.equal(restored.status().models[0].checks.tools.status, 'unverified');
    assert.equal((await readdir(dir)).some(x => x.endsWith('.dpapi')), true);
  } finally {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())+ '\\'));
    await rm(dir, { recursive: true });
  }
});
