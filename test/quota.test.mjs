import { test } from "node:test";
import assert from "node:assert/strict";
import { StandaloneService } from "../src/standalone-service.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadVault } from "../src/vault.mjs";

const fixture = {
  plan_type: "plus",
  account_id: "PRIVATE_ID",
  rate_limit: {
    primary_window: {
      used_percent: 12,
      limit_window_seconds: 18000,
      reset_at: 1800000000,
    },
    secondary_window: {
      used_percent: 45,
      limit_window_seconds: 604800,
      reset_after_seconds: 3600,
    },
  },
  code_review_rate_limit: {
    primary_window: { used_percent: 0, limit_window_seconds: 604800 },
  },
  credits: { balance: "9.5", unlimited: false },
};
function setup(fetcher) {
  const s = new StandaloneService({ dataDir: ".unused", fetcher });
  s.vault = {
    active: "a",
    accounts: {
      a: {
        email: "a@example.test",
        scopes: ["chatgpt.tokens.use.direct"],
        access_token: "INFERENCE_SECRET",
        quotaAuth: {
          access_token: "QUOTA_SECRET",
          refresh_token: "REFRESH_SECRET",
          accountId: "PRIVATE_ID",
          expiresAt: Date.now() + 3600000,
        },
      },
      b: { scopes: [] },
    },
  };
  return s;
}
test("quota independently reads official usage with its own Codex grant and returns only safe fields", async () => {
  const s = setup(async (url, o) => {
    assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
    assert.equal(o.headers.Authorization, "Bearer QUOTA_SECRET");
    assert.equal(o.headers["Chatgpt-Account-Id"], "PRIVATE_ID");
    assert.equal(o.redirect, "error");
    return Response.json(fixture);
  });
  const q = await s.quota("a");
  assert.equal(q.status, "available");
  assert.equal(q.planType, "plus");
  assert.equal(q.windows[0].usedPercent, 12);
  assert.equal(q.windows[0].resetAtMs, 1800000000000);
  assert.equal(q.windows[1].usedPercent, 45);
  assert.equal(q.windows[2].id, "code-review-weekly");
  assert.equal(q.creditBalance, "9.5");
  assert.equal(s.status().accounts[0].quota.status, "available");
  assert.doesNotMatch(
    JSON.stringify(s.status()),
    /PRIVATE_ID|QUOTA_SECRET|INFERENCE_SECRET|REFRESH_SECRET/,
  );
});
test("quota requests authorization instead of assuming an inference grant can read usage", async () => {
  const s = setup(() => assert.fail("must not send inference token"));
  assert.equal((await s.quota("b")).status, "authorization_required");
  assert.equal(s.vault.active, "a");
});
test("quota classifies swapped monthly windows, camel case and additional limits without inventing unknown percentages", async () => {
  const s = setup(async () =>
    Response.json({
      planType: "team",
      rateLimit: {
        primaryWindow: { usedPercent: 20, limitWindowSeconds: 2592000 },
        secondaryWindow: { usedPercent: 5, limitWindowSeconds: 18000 },
      },
      additionalRateLimits: [
        {
          limitName: "Extra",
          rateLimit: {
            primaryWindow: { usedPercent: "", resetAfterSeconds: 60 },
          },
        },
      ],
    }),
  );
  const q = await s.quota("a");
  assert.deepEqual(
    q.windows.map((w) => w.usedPercent),
    [5, 20, null],
  );
  assert.equal(q.windows[1].id, "monthly");
  assert.equal(q.windows[2].label, "Extra · 5 小时");
});
test("quota failure clears stale availability, sanitizes upstream errors and does not retry 401", async () => {
  let count = 0;
  const s = setup(async () =>
    ++count === 1
      ? Response.json(fixture)
      : Response.json(
          { error: { message: "QUOTA_SECRET PRIVATE_ID" } },
          { status: 401 },
        ),
  );
  await s.quota("a");
  const q = await s.quota("a");
  assert.equal(q.status, "authorization_required");
  assert.equal(count, 2);
  assert.doesNotMatch(JSON.stringify(q), /QUOTA_SECRET|PRIVATE_ID/);
  assert.equal(s.status().accounts[0].quota.windows, undefined);
});
test("quota rejects malformed success payloads and invalid percentages", async () => {
  const s = setup(async () =>
    Response.json({
      rate_limit: {
        primary_window: { used_percent: 200 },
        secondary_window: { used_percent: false },
      },
    }),
  );
  const q = await s.quota("a");
  assert.equal(q.status, "error");
});
test("quota cannot overlap account mutation or leak another account snapshot", async () => {
  let release;
  const s = setup(
    () =>
      new Promise((r) => {
        release = () => r(Response.json(fixture));
      }),
  );
  const p = s.quota("a");
  await Promise.resolve();
  await assert.rejects(() => s.updateAccount("a", { note: "x", priority: 1 }));
  release();
  await p;
  assert.notEqual(s.status().accounts[1].quota.status, "available");
});
test("reading quota with a valid grant does not interrupt concurrent model requests", async () => {
  let release;
  const s = setup((url) =>
    url.endsWith("/usage")
      ? new Promise((r) => {
          release = () => r(Response.json(fixture));
        })
      : Promise.resolve(
          new Response(
            "data: " +
              JSON.stringify({
                type: "response.completed",
                response: {
                  status: "completed",
                  output: [
                    {
                      type: "message",
                      content: [{ type: "output_text", text: "OK" }],
                    },
                  ],
                },
              }) +
              "\n\n",
            { headers: { "Content-Type": "text/event-stream" } },
          ),
        ),
  );
  s.vault.accounts.a.expiresAt = Date.now() + 3600000;
  s.models = [{ slug: "chosen", selectable: true, declared: {} }];
  s.upstreamModels = s.models;
  s.prefs.loggingToFile = false;
  const pending = s.quota("a");
  try {
    const r = await s.chat({
      model: "chosen",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(r.choices[0].message.content, "OK");
  } finally {
    release();
    await pending;
  }
});
test("expired quota grants rotate and persist before use without replacing the inference grant", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "modelbridge-quota-refresh-"));
  t.after(async () => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + "\\"));
    await rm(dir, { recursive: true });
  });
  let exchanges = 0,
    reads = 0;
  const s = setup(async (url, o) => {
    if (url === "https://auth.openai.com/oauth/token") {
      exchanges++;
      assert.equal(o.body.get("refresh_token"), "REFRESH_SECRET");
      assert.equal(o.body.has("resource"), false);
      return Response.json({
        access_token: "ROTATED_QUOTA",
        refresh_token: "ROTATED_REFRESH",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    reads++;
    assert.equal(o.headers.Authorization, "Bearer ROTATED_QUOTA");
    const disk = await loadVault(join(dir, "accounts.dpapi"));
    assert.equal(disk.accounts.a.quotaAuth.refresh_token, "ROTATED_REFRESH");
    return Response.json(fixture);
  });
  s.vaultPath = join(dir, "accounts.dpapi");
  s.vault.accounts.a.quotaAuth.expiresAt = 0;
  assert.equal((await s.quota("a")).status, "available");
  assert.equal((await s.quota("a")).status, "available");
  assert.equal(exchanges, 1);
  assert.equal(reads, 2);
  assert.equal(s.vault.accounts.a.access_token, "INFERENCE_SECRET");
});
