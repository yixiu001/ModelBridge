import { readFile, writeFile, mkdtemp, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadVault } from "../src/vault.mjs";
import { readChat, localFetch } from "../src/engine-client.mjs";
import { executeFileTool } from "../src/file-tools.mjs";
import { watchParent } from "../src/parent-lifecycle.mjs";
watchParent();
const model = process.argv[2];
if (!model) throw new Error("Exact model required");
const local = fileURLToPath(new URL("../.local/", import.meta.url));
const control = JSON.parse(await readFile(join(local, "control.json"), "utf8"));
const { key } = await loadVault(join(local, "gateway-key.dpapi"));
await mkdir(join(local, "file-probes"), { recursive: true });
const dir = await mkdtemp(join(local, "file-probes", "run-"));
const input = { nonce: randomBytes(16).toString("hex"), left: 137, right: 248 };
await writeFile(join(dir, "input.json"), JSON.stringify(input));
const report = {
  model,
  kind: "files",
  status: "failed",
  startedAt: new Date().toISOString(),
  requests: 0,
  toolCalls: 0,
};
const messages = [
  {
    role: "user",
    content:
      "Use read_file to read input.json, then write_file to create result.json with JSON keys nonce (from input) and sum (left+right), then read_file result.json to confirm the saved content. Finally reply exactly FILE_OK.",
  },
];
const tools = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read input.json or result.json in isolated test directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create result.json in isolated test directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
];
let inputRead = false,
  resultRead = false;
try {
  for (let round = 0; round < 6; round++) {
    report.requests++;
    const r = await localFetch(control.base + "/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, messages, tools, stream: true }),
      signal: AbortSignal.timeout(180000),
    });
    const answer = await readChat(r);
    messages.push(answer);
    if (!answer.tool_calls?.length) {
      if (!inputRead || !resultRead || answer.content?.trim() !== "FILE_OK")
        throw new Error("file_loop_incomplete");
      const result = JSON.parse(
        await readFile(join(dir, "result.json"), "utf8"),
      );
      if (result.nonce !== input.nonce || result.sum !== 385)
        throw new Error("file_contents_mismatch");
      report.status = "passed";
      break;
    }
    for (const call of answer.tool_calls) {
      const args = JSON.parse(call.function.arguments);
      const result = await executeFileTool(dir, call.function.name, args);
      report.toolCalls++;
      if (call.function.name === "read_file") {
        if (args.path === "input.json") inputRead = true;
        if (args.path === "result.json") resultRead = true;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
} catch (e) {
  report.error = e.details?.code || e.message;
}
report.finishedAt = new Date().toISOString();
await writeFile(join(dir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (report.status !== "passed") process.exitCode = 1;
