import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeWorkBuddyModels } from "../src/client-config.mjs";
test("only unavailable ModelBridge entries on this gateway are archived", () => {
  const url = "http://127.0.0.1:43821/workbuddy/v1/chat/completions";
  const own = {
    id: "old",
    name: "ModelBridge · old",
    url: url.replace("/workbuddy", ""),
  };
  const foreign = {
    id: "other",
    name: "Personal",
    url: "https://example.com/v1/chat/completions",
  };
  const models = [
    {
      slug: "chosen",
      displayName: "Chosen",
      selectable: true,
      checks: { tools: { status: "passed" } },
    },
  ];
  const result = mergeWorkBuddyModels([own, foreign], models, {
    url,
    key: "local",
    archiveUnavailable: true,
  });
  assert.deepEqual(
    result.map((m) => m.id),
    ["other", "chosen"],
  );
  assert.deepEqual(result[0], foreign);
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
