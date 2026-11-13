import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeUpstreamError } from "../src/error-summary.mjs";
test("error summaries retain useful parameter errors but redact credentials, emails and prompt fields", () => {
  const value = summarizeUpstreamError(
    JSON.stringify({
      error: {
        code: "invalid_parameter",
        message:
          "Unsupported parameter max_tokens; Bearer abc.def.xyz; private-key; test@example.com",
      },
      prompt: "DO_NOT_KEEP",
    }),
    ["private-key"],
  );
  assert.equal(value.code, "invalid_parameter");
  assert.match(value.message, /max_tokens/);
  for (const secret of [
    "abc.def.xyz",
    "private-key",
    "test@example.com",
    "DO_NOT_KEEP",
  ])
    assert.ok(!JSON.stringify(value).includes(secret));
  assert.equal(summarizeUpstreamError("not JSON"), null);
});
