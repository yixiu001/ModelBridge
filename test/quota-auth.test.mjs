import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StandaloneService } from "../src/standalone-service.mjs";
import { loadVault } from "../src/vault.mjs";
import { listenQuotaCallback } from "../src/quota-auth.mjs";
import { localFetch } from "../src/local-client.mjs";
test("quota callback rejects malformed paths without invoking authorization", async (t) => {
  let calls = 0;
  const server = await listenQuotaCallback(
    async () => {
      calls++;
    },
    "http://127.0.0.1:43821",
    0,
  );
  t.after(() => server.close());
  const base = "http://127.0.0.1:" + server.address().port;
  const r = await localFetch(base + "//%", {
    signal: AbortSignal.timeout(1000),
  });
  assert.equal(r.status, 400);
  await r.text();
  assert.equal(calls, 0);
});
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwks = {
  keys: [
    {
      ...publicKey.export({ format: "jwk" }),
      kid: "test",
      alg: "RS256",
      use: "sig",
    },
  ],
};
const jwt = (claims) => {
  const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString(
      "base64url",
    ),
    p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return (
    h +
    "." +
    p +
    "." +
    sign("RSA-SHA256", Buffer.from(h + "." + p), privateKey).toString(
      "base64url",
    )
  );
};
test("quota OAuth validates PKCE, nonce, signed same-account identity; stores only its own grant encrypted; rejects replay", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "modelbridge-quota-auth-"));
  const s = new StandaloneService({
    dataDir: dir,
    quotaListener: (fn, base) => listenQuotaCallback(fn, base, 0),
  });
  t.after(async () => {
    s.quotaCallback?.close();
    clearTimeout(s.quotaLoginTimer);
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + "\\"));
    await rm(dir, { recursive: true });
  });
  s.vault = {
    active: "a",
    accounts: {
      a: {
        subject: "direct-sub",
        email: "user@example.test",
        id_token: jwt({ email: "user@example.test", email_verified: true }),
        access_token: "DIRECT",
        scopes: [],
      },
    },
  };
  assert.equal(typeof s.startQuotaLogin, "function");
  const url = new URL(await s.startQuotaLogin("a", "http://127.0.0.1:43821"));
  assert.equal(url.origin, "https://auth.openai.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(
    url.searchParams.get("code_challenge"),
    createHash("sha256").update(s.pending.verifier).digest("base64url"),
  );
  const query = new URLSearchParams({ state: s.pending.state, code: "CODE" });
  let wrong = true;
  s.fetcher = async (endpoint, options) => {
    if (endpoint.endsWith("/jwks.json")) return Response.json(jwks);
    assert.equal(endpoint, "https://auth.openai.com/oauth/token");
    assert.equal(options.body.get("code_verifier"), s.pending.verifier);
    return Response.json({
      access_token: "OWN_QUOTA",
      refresh_token: "OWN_REFRESH",
      token_type: "Bearer",
      expires_in: 3600,
      id_token: jwt({
        iss: "https://auth.openai.com",
        aud: "app_EMoamEEZ73f0CkXaXp7hrann",
        sub: "native-sub",
        nonce: s.pending.nonce,
        exp: Date.now() / 1000 + 100,
        email: wrong ? "other@example.test" : "user@example.test",
        email_verified: true,
        "https://api.openai.com/auth": { chatgpt_account_id: "account-id" },
      }),
    });
  };
  await assert.rejects(
    () => s.finishLogin(new URLSearchParams({ state: "wrong", code: "CODE" })),
    /state/,
  );
  await assert.rejects(() => s.finishLogin(query), /账号/);
  assert.equal(s.vault.accounts.a.quotaAuth, undefined);
  s.cancelLogin();
  wrong = false;
  await s.startQuotaLogin("a", "http://127.0.0.1:43821");
  const valid = new URLSearchParams({
    state: s.pending.state,
    code: "NEW_CODE",
  });
  const callback =
    "http://127.0.0.1:" +
    s.quotaCallback.address().port +
    "/auth/callback?" +
    valid;
  const foreign = await localFetch(callback, {
    headers: { Host: "evil.test" },
  });
  assert.equal(foreign.status, 400);
  await foreign.text();
  assert.equal(s.pending.used, false);
  const response = await fetch(callback, { redirect: "manual" });
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    "http://127.0.0.1:43821/#quota",
  );
  const vault = await loadVault(join(dir, "accounts.dpapi"));
  assert.equal(vault.accounts.a.access_token, "DIRECT");
  assert.equal(vault.accounts.a.quotaAuth.access_token, "OWN_QUOTA");
  assert.equal(vault.accounts.a.quotaAuth.accountId, "account-id");
  assert.equal(s.pending, null);
  assert.doesNotMatch(
    JSON.stringify(s.status()),
    /OWN_QUOTA|OWN_REFRESH|account-id/,
  );
  await assert.rejects(() => s.finishLogin(valid));
});
