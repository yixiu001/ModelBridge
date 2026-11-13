import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeFileTool } from "../src/file-tools.mjs";
test("file verification tools only read the fixture and write its isolated result", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "mb-file-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "input.json"), '{"nonce":"abc"}');
  assert.equal(
    await executeFileTool(dir, "read_file", { path: "input.json" }),
    '{"nonce":"abc"}',
  );
  await assert.rejects(() =>
    executeFileTool(dir, "read_file", { path: "../secret" }),
  );
  await assert.rejects(() =>
    executeFileTool(dir, "write_file", {
      path: "input.json",
      content: "overwrite",
    }),
  );
  await executeFileTool(dir, "write_file", {
    path: "result.json",
    content: '{"nonce":"abc"}',
  });
  assert.equal(
    await readFile(join(dir, "result.json"), "utf8"),
    '{"nonce":"abc"}',
  );
});
