import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineService } from "../src/engine-service.mjs";
import { mergeWorkBuddyModels } from "../src/client-config.mjs";

test("refresh cannot overwrite discovery while a different engine connection is being validated", async (t) => {
  const { service } = await setup(t);
  service.connecting = true;
  await assert.rejects(
    () => service.refreshCatalog(),
    (e) => e.details?.code === "busy",
  );
  await service.poll();
  assert.equal(service.accounts.length, 1);
});
test("binding refuses non-Codex accounts and API-key providers rather than exposing their models", async (t) => {
  await assert.rejects(
    () => setup(t, { foreign: true }),
    (e) => e.details?.code === "codex_only_required",
  );
  await assert.rejects(
    () => setup(t, { apiKeys: true }),
    (e) => e.details?.code === "codex_only_required",
  );
});
async function setup(t, { foreign = false, apiKeys = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "mb-manage-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  let disabled = false;
  const service = new EngineService({
    dataDir: dir,
    fetcher: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path, body, method: options.method });
      let result = {};
      if (path.endsWith("/config"))
        result = {
          "codex-api-key": apiKeys
            ? [{ "api-key": "private-provider-key" }]
            : [],
        };
      if (path.endsWith("/models")) result = { data: [{ id: "gpt-test" }] };
      if (path.endsWith("/auth-files") && options.method !== "DELETE")
        result = {
          files: [
            {
              name: "codex-private.json",
              id: "private",
              auth_index: "index",
              provider: "codex",
              status: "active",
              disabled,
              id_token: { chatgpt_account_id: "private-account" },
            },
            ...(foreign ? [{ name: "other.json", provider: "claude" }] : []),
          ],
        };
      if (path.endsWith("/status")) disabled = body.disabled;
      if (path.endsWith("/api-call"))
        result = {
          status_code: 200,
          body: JSON.stringify({
            plan_type: "plus",
            secret: "NEVER_EXPOSE",
            rate_limit: {
              primary_window: {
                used_percent: 25,
                limit_window_seconds: 18000,
                reset_at: 1800000000,
              },
            },
          }),
        };
      return new Response(JSON.stringify(result));
    },
  });
  await service.connect({
    baseUrl: "http://127.0.0.1:8317",
    apiKey: "test",
    managementKey: "admin",
  });
  return { service, calls };
}
test("Codex account actions resolve private identifiers internally, reject arbitrary targets and isolate other providers", async (t) => {
  const { service, calls } = await setup(t);
  assert.equal(service.accounts.length, 1);
  const key = service.accounts[0].key;
  await assert.rejects(() => service.accountAction("other.json", "disable"));
  await service.accountAction(key, "disable");
  assert.equal(service.accounts[0].disabled, true);
  assert.deepEqual(calls.find((x) => x.path.endsWith("/status")).body, {
    name: "codex-private.json",
    disabled: true,
  });
  assert.ok(!JSON.stringify(service.status()).includes("codex-private.json"));
});
test("quota uses the fixed official URL and engine token substitution; only normalized windows reach the UI", async (t) => {
  const { service, calls } = await setup(t);
  const result = await service.quota(service.accounts[0].key);
  assert.equal(result.windows[0].usedPercent, 25);
  assert.equal(result.planType, "plus");
  const call = calls.find((x) => x.path.endsWith("/api-call"));
  assert.equal(call.body.url, "https://chatgpt.com/backend-api/wham/usage");
  assert.equal(call.body.header.Authorization, "Bearer $TOKEN$");
  assert.ok(!JSON.stringify(result).includes("NEVER_EXPOSE"));
  assert.ok(!JSON.stringify(service.status()).includes("private-account"));
});
test("WorkBuddy migration preserves capabilities and unrelated models, refusing foreign ID collisions", () => {
  const existing = [
    {
      id: "gpt-test",
      name: "CLIProxyAPI · gpt-test",
      url: "http://127.0.0.1:8317/v1/chat/completions",
      apiKey: "old",
      supportsReasoning: true,
      reasoningEffort: "low",
    },
    { id: "other", url: "https://elsewhere" },
  ];
  const models = [
    {
      slug: "gpt-test",
      displayName: "gpt-test",
      selectable: true,
      checks: { tools: { status: "passed" } },
    },
  ];
  const options = {
    url: "http://127.0.0.1:43821/v1/chat/completions",
    key: "new",
    engineUrl: "http://127.0.0.1:8317",
  };
  const result = mergeWorkBuddyModels(existing, models, options);
  assert.equal(result[0].apiKey, "new");
  assert.equal(result[0].supportsReasoning, true);
  assert.equal(result[0].reasoningEffort, "low");
  assert.deepEqual(result[1], existing[1]);
  assert.throws(() =>
    mergeWorkBuddyModels(
      [{ ...existing[0], name: "My model", url: "https://elsewhere" }],
      models,
      options,
    ),
  );
});
