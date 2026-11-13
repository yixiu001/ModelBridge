import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { summarizeUpstreamError } from "./error-summary.mjs";
export async function relayEngine({ req, res, service, path, json }) {
  if (!["/v1/models", "/v1/chat/completions", "/v1/responses"].includes(path))
    return json(404, {
      error: { code: "route_not_supported", message: "此接口暂未接入" },
    });
  if (req.method !== (path === "/v1/models" ? "GET" : "POST"))
    return json(405, { error: { code: "method_not_allowed" } });
  if (
    req.method === "POST" &&
    !req.headers["content-type"]?.startsWith("application/json")
  )
    return json(415, { error: { code: "invalid_content_type" } });
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  const row = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    path,
    status: "pending",
  };
  let upstream;
  service.gatewayActive++;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) {
        row.httpStatus = 413;
        row.status = "rejected";
        return json(413, { error: { code: "request_too_large" } });
      }
      chunks.push(chunk);
    }
    const body = req.method === "POST" ? Buffer.concat(chunks) : undefined;
    row.requestBytes = size;
    if (body)
      try {
        const parsed = JSON.parse(body.toString("utf8"));
        row.model =
          typeof parsed.model === "string" ? parsed.model.slice(0, 256) : null;
      } catch {
        /* Let the engine classify malformed payloads. */
      }
    upstream = await service.forward({
      path,
      method: req.method,
      body,
      signal: controller.signal,
      headers: req.headers,
    });
    row.httpStatus = upstream.status;
    res.setHeader("X-ModelBridge-Engine", "CLIProxyAPI");
    const headers = {};
    for (const name of ["content-type", "retry-after", "x-request-id"]) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    res.writeHead(upstream.status, headers);
    const sse = /text\/event-stream/.test(
      upstream.headers.get("content-type") || "",
    );
    let diagnostics = "";
    const decoder = new TextDecoder();
    const observe = (text) => {
      const error = summarizeUpstreamError(text, [
        service.config?.apiKey,
        service.config?.managementKey,
      ]);
      if (error) row.error = error;
    };
    if (upstream.body)
      for await (const chunk of upstream.body) {
        if (controller.signal.aborted) break;
        if (sse) {
          diagnostics += decoder.decode(chunk, { stream: true });
          let boundary;
          while ((boundary = /\r?\n\r?\n/.exec(diagnostics))) {
            const event = diagnostics
              .slice(0, boundary.index)
              .replace(/\r/g, "");
            diagnostics = diagnostics.slice(
              boundary.index + boundary[0].length,
            );
            if (event.includes('"error"'))
              observe(
                event
                  .split("\n")
                  .filter((l) => l.startsWith("data:"))
                  .map((l) => l.slice(5).trim())
                  .join("\n"),
              );
          }
          if (diagnostics.length > 16384)
            diagnostics = diagnostics.slice(-8192);
        } else if (!upstream.ok && diagnostics.length < 8192)
          diagnostics += decoder.decode(chunk, { stream: true });
        if (!res.write(chunk))
          await once(res, "drain", { signal: controller.signal });
      }
    if (!upstream.ok) observe(diagnostics);
    if (!controller.signal.aborted) {
      res.end();
      row.status = row.error
        ? "upstream_error"
        : upstream.ok
          ? "forwarded"
          : "upstream_error";
    } else row.status = "cancelled";
  } catch (e) {
    row.status = controller.signal.aborted ? "cancelled" : "failed";
    row.httpStatus ??= e.details?.httpStatus || 502;
    row.errorCode = e.details?.code || "engine_transport_error";
    if (!res.headersSent && !res.destroyed)
      json(row.httpStatus, {
        error: {
          code: row.errorCode,
          message: "本机引擎请求失败，请检查 CLIProxyAPI 状态",
        },
      });
    else if (!res.destroyed) res.destroy();
  } finally {
    if (controller.signal.aborted)
      await upstream?.body?.cancel().catch(() => {});
    service.gatewayActive--;
    row.finishedAt = new Date().toISOString();
    await service.recordTraffic(row).catch(() => {});
  }
}
