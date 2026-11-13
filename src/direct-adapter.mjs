import { convertHistory } from "./vendor/chat-history.mjs";
import { randomBytes } from "node:crypto";
import { requireModel, outputText } from "./protocol.mjs";

function fail(code) {
  const error = new Error(code);
  const upstream=/^(unexpected_upstream_tool|tool_delta_before_item|unsupported_upstream_output)/.test(code);
  error.details = { code: code.split(":")[0],source:upstream?'upstream':'client',httpStatus:upstream?502:400 };
  throw error;
}
const clientStringMetadata = [
  "agent",
  "conversationRequestId",
  "messageId",
  "model",
  "requestModelId",
  "requestModelName",
  "traceId",
];
function validUsage(value, depth = 0) {
  if (
    value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  )
    return true;
  return (
    depth < 4 &&
    value &&
    typeof value === "object" &&
    Object.keys(value).length < 40 &&
    Object.values(value).every((v) => validUsage(v, depth + 1))
  );
}
function validateMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message))
    fail("invalid_message");
  // Observed WorkBuddy routing/audit fields are not model-generation controls.
  if (
    message.startsNewUserRequest !== undefined &&
    typeof message.startsNewUserRequest !== "boolean"
  )
    fail("invalid_client_metadata");
  if (
    message.stepSeq !== undefined &&
    (!Number.isSafeInteger(message.stepSeq) || message.stepSeq < 0)
  )
    fail("invalid_client_metadata");
  for (const key of clientStringMetadata)
    if (
      message[key] !== undefined &&
      (typeof message[key] !== "string" || message[key].length > 256)
    )
      fail("invalid_client_metadata");
  if (
    message.argumentsDisplayText != null &&
    (typeof message.argumentsDisplayText !== "string" ||
      message.argumentsDisplayText.length > 100_000)
  )
    fail("invalid_client_metadata");
  for (const key of ["usage", "rawUsage"])
    if (message[key] !== undefined && !validUsage(message[key]))
      fail("invalid_client_usage");
  for (const key of Object.keys(message))
    if (
      ![
        "role",
        "content",
        "tool_calls",
        "tool_call_id",
        "name",
        "startsNewUserRequest",
        "stepSeq",
        "argumentsDisplayText",
        "usage",
        "rawUsage",
        ...clientStringMetadata,
      ].includes(key)
    )
      fail("unsupported_message_field:" + key);
  if (message.name) fail("unsupported_message_name");
}
function contentParts(content, role, model) {
  if (content === null || content === undefined) return [];
  if (typeof content === "string")
    return [
      {
        type: role === "assistant" ? "output_text" : "input_text",
        text: content,
      },
    ];
  if (!Array.isArray(content)) fail("unsupported_message_content");
  return content.map((part) => {
    if (part.type === "text" && typeof part.text === "string")
      return {
        type: role === "assistant" ? "output_text" : "input_text",
        text: part.text,
      };
    if (
      part.type === "image_url" &&
      role === "user" &&
      model.declared?.input_modalities?.includes("image")
    ) {
      if (typeof part.image_url?.url !== "string") fail("invalid_image_url");
      const detail = part.image_url.detail || "auto";
      if (!["auto", "low", "high", "original"].includes(detail))
        fail("unsupported_image_detail");
      return { type: "input_image", image_url: part.image_url.url, detail };
    }
    fail("unsupported_content_type:" + part.type);
  });
}
export class DirectAdapter {
  constructor({ catalog, request }) {
    Object.assign(this, { catalog, request });
  }
  async complete(body, { signal, onChunk } = {}) {
    const model = requireModel(this.catalog, body.model);
    const allowed = new Set([
      "model",
      "messages",
      "tools",
      "tool_choice",
      "stream",
      "stream_options",
      "parallel_tool_calls",
      "reasoning_effort",
    ]);
    for (const [key, value] of Object.entries(body))
      if (value !== undefined && value !== null && !allowed.has(key))
        fail("unsupported_parameter:" + key);
    if (!Array.isArray(body.messages) || !body.messages.length)
      fail("messages_required");
    if (body.stream !== undefined && typeof body.stream !== "boolean")
      fail("invalid_stream");
    if (
      body.stream_options &&
      Object.keys(body.stream_options).some((k) => k !== "include_usage")
    )
      fail("unsupported_stream_options");
    if (
      body.reasoning_effort &&
      !model.declared?.supported_reasoning_levels?.some(
        (r) => r.effort === body.reasoning_effort,
      )
    )
      fail("unsupported_reasoning_effort");
    const tools = (body.tools || []).map((tool) => {
      if (
        tool.type !== "function" ||
        !tool.function ||
        !/^[-a-zA-Z0-9_]{1,64}$/.test(tool.function.name)
      )
        fail("unsupported_tool_definition");
      for (const key of Object.keys(tool.function))
        if (!["name", "description", "parameters", "strict"].includes(key))
          fail("unsupported_tool_field:" + key);
      return { type: "function", ...tool.function };
    });
    if (new Set(tools.map((t) => t.name)).size !== tools.length)
      fail("duplicate_tool_name");
    const input = convertHistory(body.messages, {
      validateMessage,
      contentParts,
      model,
    });
    const request = {
      model: body.model,
      input,
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
    };
    if (tools.length)
      request.tools = [
        {
          type: "namespace",
          name: "workbuddy",
          description:
            "Functions executed and authorized by the connected client.",
          tools,
        },
      ];
    if (body.tool_choice !== undefined) {
      if (["auto", "none", "required"].includes(body.tool_choice))
        request.tool_choice = body.tool_choice;
      else if (
        body.tool_choice?.type === "function" &&
        tools.some((t) => t.name === body.tool_choice.function?.name)
      )
        request.tool_choice = {
          type: "function",
          namespace: "workbuddy",
          name: body.tool_choice.function.name,
        };
      else fail("unsupported_tool_choice");
    }
    if (body.parallel_tool_calls !== undefined)
      request.parallel_tool_calls = body.parallel_tool_calls;
    if (body.reasoning_effort)
      request.reasoning = { effort: body.reasoning_effort };
    signal?.throwIfAborted();
    const id = "chatcmpl-mb-" + randomBytes(12).toString("hex");
    const turn = "mb_" + randomBytes(16).toString("hex");
    const created = Math.floor(Date.now() / 1000);
    const indices = new Map();
    let nextIndex = 0,
      textStreamed = false;
    const chunk = (delta, finish_reason = null) =>
      onChunk?.({
        id,
        object: "chat.completion.chunk",
        created,
        model: body.model,
        choices: [{ index: 0, delta, finish_reason }],
      });
    let started = false;
    const start = () => {
      if (!started) {
        started = true;
        chunk({ role: "assistant", content: "" });
      }
    };
    const onEvent = (event) => {
      if (event.type === "response.output_text.delta") {
        start();
        textStreamed = true;
        chunk({ content: event.delta });
      }
      if (
        event.type === "response.output_item.added" &&
        event.item?.type === "function_call"
      ) {
        const item = event.item;
        if (
          item.namespace !== "workbuddy" ||
          !tools.some((t) => t.name === item.name)
        )
          fail("unexpected_upstream_tool");
        const index = nextIndex++;
        indices.set(item.id ?? event.output_index, {
          index,
          id: `${turn}_${index}`,
        });
        start();
        chunk({
          tool_calls: [
            {
              index,
              id: `${turn}_${index}`,
              type: "function",
              function: { name: item.name, arguments: item.arguments || "" },
            },
          ],
        });
      }
      if (event.type === "response.function_call_arguments.delta") {
        const mapped = indices.get(event.item_id ?? event.output_index);
        if (!mapped) fail("tool_delta_before_item");
        chunk({
          tool_calls: [
            { index: mapped.index, function: { arguments: event.delta } },
          ],
        });
      }
    };
    const response = await this.request(request, { signal, onEvent });
    signal?.throwIfAborted();
    const originalCalls = response.output.filter(
      (item) => item.type === "function_call",
    );
    for (const item of response.output)
      if (!["function_call", "message", "reasoning"].includes(item.type))
        fail("unsupported_upstream_output:" + item.type);
    const calls = originalCalls.map((item, index) => {
      if (
        item.namespace !== "workbuddy" ||
        !tools.some((t) => t.name === item.name)
      )
        fail("unexpected_upstream_tool");
      JSON.parse(item.arguments);
      const mapped = indices.get(item.id);
      return {
        id: mapped?.id || `${turn}_${index}`,
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      };
    });
    const text = outputText(response);
    start();
    if (text && !textStreamed) chunk({ content: text });
    calls.forEach((call, index) => {
      if (!indices.has(originalCalls[index].id))
        chunk({ tool_calls: [{ index, ...call }] });
    });
    const finish = calls.length ? "tool_calls" : "stop";
    chunk({}, finish);
    const usage = response.usage
      ? {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.total_tokens,
        }
      : undefined;
    if (body.stream_options?.include_usage && usage)
      onChunk?.({
        id,
        object: "chat.completion.chunk",
        created,
        model: body.model,
        choices: [],
        usage,
      });
    return {
      id,
      object: "chat.completion",
      created,
      model: body.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: text || null,
            ...(calls.length ? { tool_calls: calls } : {}),
          },
          finish_reason: finish,
        },
      ],
      ...(usage ? { usage } : {}),
    };
  }
}
