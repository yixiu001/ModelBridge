// Selectively adapted from CLIProxyAPI v8.0.69, codex_openai_request.go.
// MIT; see THIRD_PARTY_NOTICES.md. Only message/function-call reconstruction
// and bounded call-ID mapping are ported. Invalid pairs are rejected, not dropped.
import { createHash } from "node:crypto";
const fail = (code) => {
  const e = new Error(code);
  e.details = { code, httpStatus: 400 };
  throw e;
};
export function convertHistory(
  messages,
  { validateMessage, contentParts, model },
) {
  const input = [],
    pending = new Map(),
    seen = new Set();
  for (const message of messages) {
    validateMessage(message);
    if (message.role === "tool") {
      const id = pending.get(message.tool_call_id);
      if (!id) fail("orphan_tool_result");
      if (typeof message.content !== "string")
        fail("unsupported_tool_result_content");
      input.push({
        type: "function_call_output",
        call_id: id,
        output: message.content,
      });
      pending.delete(message.tool_call_id);
      continue;
    }
    if (pending.size) fail("missing_tool_results");
    if (!["system", "developer", "user", "assistant"].includes(message.role))
      fail("unsupported_message_role");
    const role = message.role === "system" ? "developer" : message.role;
    const content = contentParts(message.content, role, model).filter(
      (part) =>
        !["input_text", "output_text"].includes(part.type) || part.text !== "",
    );
    if (content.length) input.push({ role, content });
    if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls))
      fail("invalid_tool_calls");
    for (const call of message.tool_calls || []) {
      if (
        role !== "assistant" ||
        call.type !== "function" ||
        typeof call.id !== "string" ||
        !call.id ||
        call.id.length > 1024 ||
        typeof call.function?.arguments !== "string" ||
        !/^[-a-zA-Z0-9_]{1,64}$/.test(call.function?.name)
      )
        fail("invalid_tool_call");
      if (seen.has(call.id)) fail("duplicate_tool_call_id");
      seen.add(call.id);
      try {
        JSON.parse(call.function.arguments);
      } catch {
        fail("invalid_tool_arguments");
      }
      const id =
        call.id.length <= 64
          ? call.id
          : "call_" +
            createHash("sha256").update(call.id).digest("hex").slice(0, 59);
      pending.set(call.id, id);
      input.push({
        type: "function_call",
        namespace: "workbuddy",
        call_id: id,
        name: call.function.name,
        arguments: call.function.arguments,
      });
    }
  }
  if (pending.size) fail("missing_tool_results");
  return input;
}
