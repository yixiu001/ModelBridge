import { randomBytes, createHash, createPublicKey, verify, timingSafeEqual } from 'node:crypto';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const TOKEN_ENDPOINT = `${ISSUER}/api/accounts/oauth/token`;
export const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
export function secureEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function beginLogin({ hostId, redirectUri, account }) {
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || redirect.pathname !== '/auth/callback') throw new Error('invalid redirect URI');
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const url = new URL(`${ISSUER}/api/accounts/authorize`);
  url.search = new URLSearchParams({
    client_id: account?.client_id || 'dynamic_agent_client',
    ext_agent_host_id: hostId, response_type: 'code', redirect_uri: redirectUri,
    scope: `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`,
    resource: RESOURCE, state, nonce, code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  }).toString();
  if (!account?.client_id) url.searchParams.set('agent_name_hint', 'ModelBridge');
  if (account?.id_token) url.searchParams.set('id_token_hint', account.id_token);
  return { url: url.href, state, nonce, verifier, redirectUri, account, expiresAt: Date.now() + 10*60_000, used: false };
}
export function acceptCallback(pending, query) {
  if (!pending || pending.expiresAt < Date.now()) throw new Error('login expired');
  if (pending.used) throw new Error('login already used');
  if (query.getAll('state').length !== 1 || !secureEqual(query.get('state'), pending.state)) throw new Error('invalid OAuth state');
  if (query.has('error')) { pending.used = true; throw new Error('authorization declined or unavailable'); }
  const clientId = query.get('client_id') || pending.account?.client_id;
  if (!clientId || clientId === 'dynamic_agent_client' || (pending.account?.client_id && pending.account.client_id !== clientId)) throw new Error('invalid callback client');
  const code = query.get('code');
  if (!code || query.getAll('code').length !== 1 || query.getAll('client_id').length > 1) throw new Error('missing or ambiguous authorization code');
  pending.used = true;
  return { clientId, code };
}
// This verification harness accepts only the documented RS256 ID-token signature.
// An unexpected signing algorithm fails closed instead of guessing compatibility.
export function validateIdToken(token, { jwks, clientId, nonce, expectedSubject }) {
  if (typeof token !== 'string' || token.length > 64_000) throw new Error('invalid ID token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid ID token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  if (header.alg !== 'RS256' || header.crit) throw new Error('unsupported ID token signature');
  const keys = jwks.keys.filter(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
  if (keys.length !== 1) throw new Error('ID token signing key not found');
  const key = createPublicKey({ key: keys[0], format: 'jwk' });
  if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw new Error('invalid ID token signature');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  const now = Date.now()/1000;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !audiences.includes(clientId) || (audiences.length > 1 && claims.azp !== clientId) || (claims.azp && claims.azp !== clientId)) throw new Error('invalid ID token issuer/audience');
  if (typeof claims.exp !== 'number' || claims.exp <= now || (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now + 30))) throw new Error('ID token expired or not yet valid');
  if (typeof claims.sub !== 'string' || !claims.sub || !secureEqual(claims.nonce, nonce)) throw new Error('invalid ID token identity/nonce');
  if (expectedSubject && claims.sub !== expectedSubject) throw new Error('account identity changed');
  return claims;
}
