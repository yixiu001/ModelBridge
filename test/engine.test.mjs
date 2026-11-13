import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineService, validateEngineConfig } from "../src/engine-service.mjs";
import { createApp } from "../src/http.mjs";
import { readChat } from "../src/engine-client.mjs";

async function fixture(t, handler) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), "mb-engine-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const catalog = {
  object: "list",
  data: [
    { id: "exact-model", object: "model", owned_by: "openai" },
    { id: "gpt-image-example", object: "model" },
  ],
};
function management(req, res) {
  if (req.url === "/v0/management/config") {
    res.end("{}");
    return true;
  }
  if (req.url === "/v1/models") {
    assert.equal(req.headers.authorization, "Bearer engine-api");
    res.end(JSON.stringify(catalog));
    return true;
  }
  if (req.url === "/v0/management/auth-files") {
    assert.equal(req.headers.authorization, "Bearer engine-admin");
    res.end(
      JSON.stringify({
        files: [
          {
            id: "private-id",
            name: "private-email.json",
            provider: "codex",
            status: "active",
            disabled: false,
            id_token: "NEVER_EXPOSE",
            path: "PRIVATE_PATH",
            email: "PRIVATE_EMAIL",
          },
        ],
      }),
    );
    return true;
  }
  return false;
}
test("engine binding rejects remote or ambiguous destinations before sending credentials", () => {
  for (const url of [
    "https://example.com",
    "http://127.0.0.1@evil.test",
    "http://localhost/x",
    "http://127.0.0.1/?x=1",
    "file:///secret",
    "http://0.0.0.0:8317",
  ])
    assert.throws(() =>
      validateEngineConfig({ baseUrl: url, apiKey: "a", managementKey: "b" }),
    );
  assert.equal(
    validateEngineConfig({
      baseUrl: "http://127.0.0.1:8317/",
      apiKey: "a",
      managementKey: "b",
    }).baseUrl,
    "http://127.0.0.1:8317",
  );
});
test("binding validates both keys, encrypts them, redacts account metadata and restores without legacy verification", async (t) => {
  const base = await fixture(t, (q, r) => {
    if (!management(q, r)) {
      r.statusCode = 404;
      r.end();
    }
  });
  const dir = await directory(t);
  const service = new EngineService({ dataDir: dir });
  await service.init();
  await service.connect({
    baseUrl: base,
    apiKey: "engine-api",
    managementKey: "engine-admin",
  });
  const state = service.status();
  assert.equal(state.engine.reachable, true);
  assert.equal(state.models.length, 2);
  assert.equal(state.models[1].kind, "image");
  assert.equal(state.models[0].checks.tools.status, "unverified");
  for (const secret of [
    "engine-api",
    "engine-admin",
    "NEVER_EXPOSE",
    "PRIVATE_PATH",
    "PRIVATE_EMAIL",
    "private-email",
  ])
    assert.ok(!JSON.stringify(state).includes(secret));
  assert.ok(
    !(await readFile(join(dir, "engine.dpapi"))).includes(
      Buffer.from("engine-api"),
    ),
  );
  const restored = new EngineService({ dataDir: dir });
  await restored.init();
  assert.equal(restored.status().engine.reachable, true);
});
test("gateway preserves exact request bytes and upstream SSE without synthetic finish markers", async (t) => {
  let captured;
  const stream =
    'data: {"choices":[{"delta":{"tool_calls":[{"id":"opaque","index":0}]}}]}\n\ndata: [DONE]\n\n';
  const base = await fixture(t, async (q, r) => {
    if (management(q, r)) return;
    const chunks = [];
    for await (const c of q) chunks.push(c);
    captured = {
      body: Buffer.concat(chunks).toString(),
      auth: q.headers.authorization,
      session: q.headers["x-session-id"],
    };
    r.setHeader("Content-Type", "text/event-stream");
    r.end(stream);
  });
  const service = new EngineService({ dataDir: await directory(t) });
  await service.connect({
    baseUrl: base,
    apiKey: "engine-api",
    managementKey: "engine-admin",
  });
  const app = createApp({ service, controlKey: "admin", gatewayKey: "client" });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        app.closeAllConnections();
        app.close(r);
      }),
  );
  const endpoint = `http://127.0.0.1:${app.address().port}`;
  const body =
    '{ "model":"exact-model", "messages":[], "stream":true, "vendor_extension":{"opaque":"原样"} }';
  const response = await fetch(endpoint + "/workbuddy/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: "Bearer client",
      "content-type": "application/json",
      "x-session-id": "session-test",
    },
    body,
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), stream);
  assert.deepEqual(captured, {
    body,
    auth: "Bearer engine-api",
    session: "session-test",
  });
  assert.equal(
    (
      await fetch(endpoint + "/v1/models", {
        headers: { authorization: "Bearer admin" },
      })
    ).status,
    401,
  );
  assert.equal(response.headers.get("x-modelbridge-engine"), "CLIProxyAPI");
  assert.equal(response.headers.get("x-modelbridge-compatibility"), null);
});

test("CRLF stream errors are forwarded unchanged and recorded as redacted failures", async (t) => {
  const payload =
    'data: {"error":{"code":"invalid_parameter","message":"max_tokens unsupported; engine-api"}}\r\n\r\ndata: [DONE]\r\n\r\n';
  const base = await fixture(t, (q, r) => {
    if (management(q, r)) return;
    r.setHeader("content-type", "text/event-stream");
    r.end(payload);
  });
  const service = new EngineService({ dataDir: await directory(t) });
  await service.connect({
    baseUrl: base,
    apiKey: "engine-api",
    managementKey: "engine-admin",
  });
  const app = createApp({ service, controlKey: "admin", gatewayKey: "client" });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        app.closeAllConnections();
        app.close(r);
      }),
  );
  const r = await fetch(
    `http://127.0.0.1:${app.address().port}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer client",
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  assert.equal(await r.text(), payload);
  assert.equal(service.traffic.at(-1).status, "upstream_error");
  assert.equal(service.traffic.at(-1).error.code, "invalid_parameter");
  assert.ok(!JSON.stringify(service.traffic).includes("engine-api"));
});
test("upstream errors retain status and JSON; unavailable engine yields 502 instead of 400", async (t) => {
  const base = await fixture(t, (q, r) => {
    if (management(q, r)) return;
    r.statusCode = 400;
    r.setHeader("Content-Type", "application/json");
    r.end('{"error":{"code":"upstream_bad_parameter"}}');
  });
  const service = new EngineService({ dataDir: await directory(t) });
  await service.connect({
    baseUrl: base,
    apiKey: "engine-api",
    managementKey: "engine-admin",
  });
  const response = await service.forward({
    path: "/v1/chat/completions",
    method: "POST",
    body: Buffer.from("{}"),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "upstream_bad_parameter" },
  });
  service.config.baseUrl = "http://127.0.0.1:1";
  await assert.rejects(
    () =>
      service.forward({
        path: "/v1/chat/completions",
        method: "POST",
        body: Buffer.from("{}"),
      }),
    (e) => e.details.httpStatus === 502,
  );
});
test("failed refresh marks old model catalog stale and prevents a green health badge", async (t) => {
  let failed = false;
  const base = await fixture(t, (q, r) => {
    if (failed) {
      r.statusCode = 503;
      r.end("{}");
      return;
    }
    management(q, r);
  });
  const service = new EngineService({ dataDir: await directory(t) });
  await service.connect({
    baseUrl: base,
    apiKey: "engine-api",
    managementKey: "engine-admin",
  });
  failed = true;
  await assert.rejects(() => service.refreshCatalog());
  assert.equal(service.status().engine.reachable, false);
  assert.equal(service.status().catalogStale, true);
});
test("a truncated success stream cannot pass verification or gain a fabricated DONE", async (t) => {
  const base = await fixture(t, (q, r) => {
    if (management(q, r)) return;
    r.setHeader("Content-Type", "text/event-stream");
    r.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
  });
  const service = new EngineService({ dataDir: await directory(t) });
  await service.connect({
    baseUrl: base,
    apiKey: "engine-api",
    managementKey: "engine-admin",
  });
  const report = await service.verify("exact-model", "text");
  assert.equal(report.status, "failed");
  assert.equal(report.error.code, "incomplete_stream");
  assert.equal(service.job, null);
  await assert.rejects(
    () =>
      readChat(
        new Response(
          'data: {"error":{"message":"SECRET"}}\n\ndata: [DONE]\n\n',
          { headers: { "content-type": "text/event-stream" } },
        ),
      ),
    (e) =>
      e.details.code === "upstream_stream_error" &&
      !e.message.includes("SECRET"),
  );
});
test("real echo verification preserves tool call identity and persists only the current engine context", async (t) => {
  let calls = 0;
  const base = await fixture(t, async (q, r) => {
    if (management(q, r)) return;
    let raw = "";
    for await (const c of q) raw += c;
    const b = JSON.parse(raw);
    calls++;
    assert.equal(b.model, "exact-model");
    const marker = b.messages[0].content.match(/MB_[a-f0-9]+/)[0];
    if (calls === 1)
      r.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-original",
                    type: "function",
                    function: {
                      name: "echo",
                      arguments: JSON.stringify({ text: marker }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    else {
      assert.equal(b.messages.at(-1).tool_call_id, "call-original");
      assert.equal(JSON.parse(b.messages.at(-1).content).text, marker);
      r.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", content: marker },
            },
          ],
        }),
      );
    }
  });
  const dir = await directory(t);
  const service = new EngineService({ dataDir: dir });
  await service.connect({
    baseUrl: base,
    apiKey: "engine-api",
    managementKey: "engine-admin",
  });
  const report = await service.verify("exact-model", "tools");
  assert.equal(report.status, "passed");
  assert.equal(report.toolCalls, 1);
  assert.equal(report.requests, 2);
  const restored = new EngineService({ dataDir: dir });
  await restored.init();
  assert.equal(restored.status().models[0].checks.tools.status, "passed");
});
test("cancelling an active verification interrupts the actual upstream connection", async (t) => {
  let started;
  const entered = new Promise((r) => {
    started = r;
  });
  let closed;
  const disconnected = new Promise((r) => {
    closed = r;
  });
  const base = await fixture(t, (q, r) => {
    if (management(q, r)) return;
    r.setHeader("Content-Type", "text/event-stream");
    r.write('data: {"choices":[]}\n\n');
    r.on("close", closed);
    started();
  });
  const service = new EngineService({ dataDir: await directory(t) });
  await service.connect({
    baseUrl: base,
    apiKey: "engine-api",
    managementKey: "engine-admin",
  });
  const running = service.verify("exact-model", "text");
  await entered;
  service.cancel();
  const report = await running;
  assert.equal(report.status, "cancelled_or_timeout");
  assert.equal(service.status().busy, null);
  await Promise.race([
    disconnected,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("upstream was not cancelled")),
        1500,
      );
      timer.unref();
    }),
  ]);
});
test("OAuth flows stay in the engine and status never exposes the pending state", async (t) => {
  let pending = true;
  const base = await fixture(t, (q, r) => {
    if (management(q, r)) return;
    if (q.url === "/v0/management/codex-auth-url?is_webui=true")
      return r.end(
        JSON.stringify({
          url: "https://auth.openai.com/oauth/authorize?state=private-state",
          state: "private-state",
        }),
      );
    if (q.url === "/v0/management/get-auth-status?state=private-state")
      return r.end(JSON.stringify({ status: pending ? "wait" : "ok" }));
    r.statusCode = 404;
    r.end();
  });
  const service = new EngineService({ dataDir: await directory(t) });
  await service.connect({
    baseUrl: base,
    apiKey: "engine-api",
    managementKey: "engine-admin",
  });
  assert.match(await service.startLogin(), /^https:\/\/auth.openai.com\//);
  assert.equal(service.status().loginPending, true);
  for (const kind of ["text", "tools", "files", "mcp", "long"])
    await assert.rejects(
      service.verify("exact-model", kind),
      (e) => e.details?.code === "busy",
    );
  assert.ok(!JSON.stringify(service.status()).includes("private-state"));
  pending = false;
  await service.poll();
  assert.equal(service.status().loginPending, false);
});

test("report storage failure releases the verification lock", async (t) => {
  const dir = await directory(t);
  await mkdir(join(dir, "engine-reports.json"));
  const service = new EngineService({ dataDir: dir });
  service.reachable = true;
  service.models = [{ slug: "exact-model", selectable: true }];
  service.forward = async () => {
    throw new Error("test upstream error");
  };
  await assert.rejects(service.verify("exact-model", "text"));
  assert.equal(service.job, null);
  assert.equal(service.reports.length, 1);
});
