import { request } from "node:http";
import { Readable } from "node:stream";

// Direct loopback HTTP: never send engine credentials through an environment proxy.
export function localFetch(
  url,
  { method = "GET", headers = {}, body, signal } = {},
) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers, signal }, (incoming) => {
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(incoming.headers))
        if (value !== undefined)
          responseHeaders.set(
            key,
            Array.isArray(value) ? value.join(", ") : value,
          );
      const stream = [204, 205, 304].includes(incoming.statusCode)
        ? null
        : Readable.toWeb(incoming);
      if (!stream) incoming.resume();
      resolve(
        new Response(stream, {
          status: incoming.statusCode,
          headers: responseHeaders,
        }),
      );
    });
    req.on("error", reject);
    req.end(body);
  });
}

export function clientError(
  message,
  code = "service_unavailable",
  httpStatus = 502,
) {
  return Object.assign(new Error(message), { details: { code, httpStatus } });
}

export async function readChat(response, { signal } = {}) {
  if (!response.ok) {
    await response.body?.cancel();
    throw clientError(
      `服务返回 HTTP ${response.status}；请查看服务状态或请求参数`,
      "upstream_error",
      response.status,
    );
  }
  const text = await response.text();
  signal?.throwIfAborted();
  if (!/text\/event-stream/i.test(response.headers.get("content-type") || "")) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw clientError("服务响应格式不正确", "invalid_engine_response");
    }
    if (value.error || !value.choices?.[0]?.finish_reason)
      throw clientError("服务响应未完整结束", "incomplete_stream");
    return value.choices[0].message;
  }
  const message = { role: "assistant", content: "" };
  const calls = new Map();
  let done = false,
    finish = false;
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      throw clientError("服务流数据格式不正确", "invalid_engine_response");
    }
    if (chunk.error)
      throw clientError("服务在响应过程中报告失败", "upstream_stream_error");
    for (const choice of chunk.choices || []) {
      if (choice.finish_reason) finish = true;
      message.content += choice.delta?.content || "";
      for (const part of choice.delta?.tool_calls || []) {
        const call = calls.get(part.index) || {
          id: "",
          type: "function",
          function: { name: "", arguments: "" },
        };
        if (part.id) call.id = part.id;
        call.function.name += part.function?.name || "";
        call.function.arguments += part.function?.arguments || "";
        calls.set(part.index, call);
      }
    }
  }
  if (!done || !finish)
    throw clientError("响应提前中断，未标记测试成功", "incomplete_stream");
  if (calls.size)
    message.tool_calls = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v);
  return message;
}
