import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectAdapter } from "../src/direct-adapter.mjs";
const catalog = [
  {
    slug: "chosen",
    selectable: true,
    declared: { supported_reasoning_levels: [{ effort: "low" }] },
  },
];
const tools = [
  {
    type: "function",
    function: {
      name: "read_file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    },
  },
];
const call = (id) => ({
  id,
  type: "function",
  function: { name: "read_file", arguments: '{"path":"a"}' },
});
const result = {
  output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }],
};
test("stateless conversion resumes imported history after restart and preserves current projected outputs", async () => {
  let sent;
  const adapter = new DirectAdapter({
    catalog,
    request: async (body) => {
      sent = body;
      return result;
    },
  });
  const content = "<persisted-output>current client preview</persisted-output>";
  const messages = [
    { role: "system", content: "Updated instructions" },
    { role: "user", content: "Summarized earlier conversation" },
    {
      role: "assistant",
      content: "Reading",
      tool_calls: [call("old-client-id")],
    },
    { role: "tool", tool_call_id: "old-client-id", content },
  ];
  await adapter.complete({ model: "chosen", messages, tools });
  assert.equal(sent.input[0].role, "developer");
  assert.equal(sent.input[2].content[0].text, "Reading");
  assert.deepEqual(sent.input[3], {
    type: "function_call",
    namespace: "workbuddy",
    call_id: "old-client-id",
    name: "read_file",
    arguments: '{"path":"a"}',
  });
  assert.equal(sent.input[4].output, content);
  assert.equal(sent.input[4].call_id, "old-client-id");
  assert.equal(
    sent.input.some((i) => i.type === "reasoning"),
    false,
  );
});
test("80 turns and long call IDs preserve exact tool-result pairing without any stored state", async () => {
  let sent;
  const adapter = new DirectAdapter({
    catalog,
    request: async (b) => {
      sent = b;
      return result;
    },
  });
  const messages = [{ role: "user", content: "Start" }];
  for (let i = 0; i < 80; i++) {
    const id = "old_client_" + i + "x".repeat(80);
    messages.push(
      { role: "assistant", content: null, tool_calls: [call(id)] },
      { role: "tool", tool_call_id: id, content: "result " + i },
    );
  }
  await adapter.complete({ model: "chosen", messages, tools });
  const calls = sent.input.filter((i) => i.type === "function_call"),
    outputs = sent.input.filter((i) => i.type === "function_call_output");
  assert.equal(calls.length, 80);
  assert.equal(new Set(calls.map((c) => c.call_id)).size, 80);
  calls.forEach((c, i) => {
    assert.ok(c.call_id.length <= 64);
    assert.equal(c.call_id, outputs[i].call_id);
    assert.equal(outputs[i].output, "result " + i);
  });
});
test("invalid tool histories fail before inference instead of silently dropping their contents", async () => {
  const a = new DirectAdapter({
    catalog,
    request: async () => {
      throw new Error("must not infer");
    },
  });
  const assistant = {
    role: "assistant",
    content: null,
    tool_calls: [call("a")],
  };
  for (const [messages, error] of [
    [[assistant], /missing_tool_results/],
    [[{ role: "tool", tool_call_id: "a", content: "x" }], /orphan_tool_result/],
    [
      [{ ...assistant, tool_calls: [call("a"), call("a")] }],
      /duplicate_tool_call_id/,
    ],
  ])
    await assert.rejects(
      () => a.complete({ model: "chosen", messages, tools }),
      error,
    );
});
test("streamed tool IDs remain stable in final messages and next-turn reconstruction", async () => {
  const chunks = [];
  const a = new DirectAdapter({
    catalog,
    request: async (b, { onEvent }) => {
      onEvent({
        type: "response.output_item.added",
        item: {
          type: "function_call",
          namespace: "workbuddy",
          id: "i",
          name: "read_file",
          arguments: "",
        },
      });
      onEvent({
        type: "response.function_call_arguments.delta",
        item_id: "i",
        delta: "{}",
      });
      return {
        output: [
          {
            type: "function_call",
            id: "i",
            namespace: "workbuddy",
            call_id: "u",
            name: "read_file",
            arguments: "{}",
          },
        ],
      };
    },
  });
  const r = await a.complete(
    { model: "chosen", messages: [{ role: "user", content: "Read" }], tools },
    { onChunk: (c) => chunks.push(c) },
  );
  assert.equal(
    chunks.flatMap((c) => c.choices[0].delta.tool_calls || [])[0].id,
    r.choices[0].message.tool_calls[0].id,
  );
  assert.equal(chunks.at(-1).choices[0].finish_reason, "tool_calls");
});

test("tool-only assistant messages never send empty message items upstream", async () => {
  let sent;
  const a = new DirectAdapter({
    catalog,
    request: async (b) => {
      sent = b;
      return result;
    },
  });
  for (const content of ["", null, [{ type: "text", text: "" }]]) {
    await a.complete({
      model: "chosen",
      tools,
      messages: [
        { role: "assistant", content, tool_calls: [call("x")] },
        { role: "tool", tool_call_id: "x", content: "ok" },
      ],
    });
    assert.deepEqual(
      sent.input.map((i) => i.type),
      ["function_call", "function_call_output"],
    );
  }
});
