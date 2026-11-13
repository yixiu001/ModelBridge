import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { secureEqual } from "./auth.mjs";
import { safeError } from "./service.mjs";
import { configureWorkBuddy } from "./client-config.mjs";

const web = new URL("../dist/", import.meta.url);
export function createApp({ service, controlKey, gatewayKey }) {
  const session = randomBytes(32).toString("base64url");
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    function json(status, value) {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(value));
    }
    const base = `http://127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== new URL(base).host || !req.url.startsWith("/"))
      return json(403, { error: "invalid host" });
    const url = new URL(req.url, base);
    const bearer = secureEqual(
      req.headers.authorization,
      `Bearer ${controlKey}`,
    );
    const cookie = req.headers.cookie
      ?.split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith("mb_session="))
      ?.slice(11);
    try {
      const workbuddy = url.pathname.startsWith("/workbuddy/v1/");
      const apiPath = workbuddy
        ? url.pathname.slice("/workbuddy".length)
        : url.pathname;
      if (apiPath.startsWith("/v1/")) {
        if (
          !gatewayKey ||
          !secureEqual(req.headers.authorization, `Bearer ${gatewayKey}`)
        )
          return json(401, {
            error: {
              message: "ModelBridge inference key required",
              type: "authentication_error",
              code: "invalid_api_key",
            },
          });
        if (req.headers.origin && req.headers.origin !== base)
          return json(403, {
            error: {
              message: "foreign origin rejected",
              code: "origin_rejected",
            },
          });
        if (workbuddy)
          res.setHeader("X-ModelBridge-Compatibility", "workbuddy-v1");
        if (apiPath === "/v1/models" && req.method === "GET") {
          if (!service.models.length) await service.refreshCatalog();
          return json(200, {
            object: "list",
            data: service.models
              .filter((m) => m.selectable)
              .map((m) => ({
                id: m.slug,
                object: "model",
                created: 0,
                owned_by: "openai",
              })),
          });
        }
        if (
          apiPath !== "/v1/chat/completions" &&
          !(apiPath === "/v1/responses" && service.responses)
        )
          return json(404, {
            error: {
              message: "unsupported route",
              code: "route_not_supported",
            },
          });
        if (req.method !== "POST")
          return json(405, {
            error: { message: "POST required", code: "method_not_allowed" },
          });
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return json(415, {
            error: { message: "JSON required", code: "invalid_content_type" },
          });
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 16 * 1024 * 1024)
            return json(413, {
              error: {
                message: "request too large",
                code: "request_too_large",
              },
            });
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const controller = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) controller.abort();
        });
        let streamStarted = false;
        const write = (chunk) => {
          if (controller.signal.aborted) return;
          if (!streamStarted) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream; charset=utf-8",
              Connection: "keep-alive",
            });
            streamStarted = true;
          }
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        };
        try {
          const result =
            apiPath === "/v1/responses"
              ? await service.responses(body, {
                  signal: controller.signal,
                  onEvent: body.stream ? write : undefined,
                })
              : await service.chat(body, {
                  signal: controller.signal,
                  onChunk: body.stream ? write : undefined,
                  compatibility: workbuddy ? "workbuddy" : "strict",
                });
          if (body.stream) {
            if (!streamStarted) write({ choices: [] });
            res.end("data: [DONE]\n\n");
          } else json(200, result);
        } catch (error) {
          await service.recordRejected?.(error, body, apiPath);
          const safe = safeError(error);
          service.lastError = safe;
          const envelope = {
            error: {
              message: safe.message,
              type: "modelbridge_error",
              code: safe.code || "request_failed",
            },
          };
          if (streamStarted) {
            write(envelope);
            res.end();
          } else json(safe.httpStatus || 400, envelope);
        }
        return;
      }
      if (
        url.pathname === "/auth/callback" &&
        req.method === "GET" &&
        service.finishLogin
      ) {
        try {
          await service.finishLogin(url.searchParams);
        } catch (error) {
          service.lastError = safeError(error);
        }
        res.writeHead(303, { Location: "/" });
        res.end();
        return;
      }
      if (
        (url.pathname === "/" ||
          /^\/assets\/[A-Za-z0-9_-]+\.(js|css)$/.test(url.pathname)) &&
        req.method === "GET"
      ) {
        if (url.pathname === "/")
          res.setHeader(
            "Set-Cookie",
            `mb_session=${session}; HttpOnly; SameSite=Strict; Path=/`,
          );
        const file =
          url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        res.writeHead(200, {
          "Content-Type": file.endsWith(".html")
            ? "text/html; charset=utf-8"
            : file.endsWith(".js")
              ? "text/javascript; charset=utf-8"
              : "text/css; charset=utf-8",
        });
        res.end(await readFile(new URL(file, web)));
        return;
      }
      if (!bearer && !secureEqual(cookie, session))
        return json(401, { error: "local authentication required" });
      if (url.pathname === "/api/status" && req.method === "GET") {
        await service.poll?.();
        return json(200, service.status());
      }
      if (url.pathname === "/api/connection" && req.method === "GET")
        return json(200, {
          baseUrl: base + "/workbuddy/v1",
          chatUrl: base + "/workbuddy/v1/chat/completions",
          apiKey: gatewayKey,
        });
      if (req.method !== "POST") return json(405, { error: "POST required" });
      if ((!bearer || req.headers.origin) && req.headers.origin !== base)
        return json(403, { error: "foreign origin rejected" });
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return json(415, { error: "JSON required" });
      let bytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 16_384) return json(413, { error: "request too large" });
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (url.pathname === "/api/workbuddy/configure" && service.direct) {
        if (service.job || service.gatewayActive || !service.reachable)
          return json(409, { error: "请等待操作结束，并确认引擎已连接" });
        return json(
          200,
          await configureWorkBuddy({ service, base, key: gatewayKey }),
        );
      }
      if (url.pathname === "/api/accounts/action" && service.accountAction)
        return json(200, await service.accountAction(data.key, data.action));
      if (url.pathname === "/api/accounts/quota" && service.quota)
        return json(200, await service.quota(data.key));
      if (
        url.pathname === "/api/accounts/quota/login" &&
        service.startQuotaLogin
      )
        return json(200, {
          url: await service.startQuotaLogin(data.key, base),
        });
      if (url.pathname === "/api/accounts/batch" && service.accountsBatch)
        return json(200, await service.accountsBatch(data.keys, data.action));
      if (url.pathname === "/api/accounts/update" && service.updateAccount)
        return json(200, await service.updateAccount(data.key, data.fields));
      if (url.pathname === "/api/accounts/models" && service.accountModels)
        return json(200, await service.accountModels(data.key));
      if (url.pathname === "/api/login/cancel" && service.cancelLogin)
        return json(200, await service.cancelLogin());
      if (url.pathname === "/api/login/callback" && service.submitLoginCallback)
        return json(200, await service.submitLoginCallback(data.url));
      if (url.pathname === "/api/models/rules" && service.modelRules)
        return json(200, await service.modelRules());
      if (url.pathname === "/api/models/rules/save" && service.saveModelRules)
        return json(200, await service.saveModelRules(data));
      if (url.pathname === "/api/logs/engine" && service.engineLogs)
        return json(200, await service.engineLogs());
      if (url.pathname === "/api/settings/document" && service.settingsDocument)
        return json(200, service.settingsDocument());
      if (url.pathname === "/api/settings/preview" && service.previewSettings)
        return json(200, service.previewSettings(data));
      if (url.pathname === "/api/settings/export" && service.exportSettings)
        return json(200, service.exportSettings());
      if (url.pathname === "/api/settings/restore" && service.restoreSettings)
        return json(200, await service.restoreSettings(data));
      if (url.pathname === "/api/settings/read" && service.settings)
        return json(200, await service.settings());
      if (url.pathname === "/api/settings/save" && service.updateSettings)
        return json(200, await service.updateSettings(data));
      if (url.pathname === "/api/login")
        return json(200, {
          url: await service.startLogin(
            `${base}/auth/callback`,
            data.newAccount === true,
          ),
        });
      if (url.pathname === "/api/models/refresh")
        return json(200, { models: await service.refreshCatalog() });
      if (url.pathname === "/api/account" && service.selectAccount) {
        await service.selectAccount(data.key);
        return json(200, { ok: true });
      }
      if (url.pathname === "/api/cancel") {
        service.cancel();
        return json(200, { ok: true });
      }
      if (url.pathname === "/api/verify")
        return json(200, await service.verify(data.model, data.kind));
      return json(404, { error: "not found" });
    } catch (error) {
      const safe = safeError(error);
      service.lastError = safe;
      if (!res.headersSent) json(safe.httpStatus || 400, { error: safe });
      else res.end();
    }
  });
}
