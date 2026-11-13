import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StandaloneService } from "../src/standalone-service.mjs";
import { createApp } from "../src/http.mjs";
const model = {
  slug: "chosen",
  selectable: true,
  declared: { supported_reasoning_levels: [{ effort: "low" }] },
};
test('system information and manual release checks expose no environment credentials',async t=>{
 const {s}=await setup(t);const info=s.systemInfo();assert.equal(info.mode,'standalone');assert.ok(info.nodeVersion);assert.doesNotMatch(JSON.stringify(info),/SECRET_TOKEN/);
 s.fetcher=async url=>{assert.equal(url,'https://api.github.com/repos/yixiu001/ModelBridge/releases/latest');return Response.json({tag_name:'v0.4.0',html_url:'https://github.com/yixiu001/ModelBridge/releases/tag/v0.4.0',body:'PRIVATE'});};
 assert.deepEqual(await s.latestVersion(),{version:'v0.4.0',url:'https://github.com/yixiu001/ModelBridge/releases/tag/v0.4.0'});
});
test('catalog failures preserve a marked snapshot and old reports remain historical',async t=>{
 const {s}=await setup(t);await s.refreshCatalog();
 await s.saveReport({model:'chosen',kind:'tools',status:'passed',context:s.context});
 s.fetcher=async()=>{throw new TypeError('network');};
 await assert.rejects(()=>s.refreshCatalog());assert.equal(s.models[0].slug,'chosen');assert.equal(s.status().catalog.stale,true);
 await s.saveModelRules({kind:'excluded',revision:s.modelRules().revision,values:['chosen']});
 assert.equal(s.reports.length,0);assert.equal(s.status().reportHistory.length,1);
});
test('Responses unsupported effort is rejected before upstream and tool streams are never retried', async t=>{
 const {s,calls}=await setup(t);
 await assert.rejects(()=>s.responses({model:'chosen',input:'hi',reasoning:{effort:'none'}}),e=>e.details?.param==='reasoning.effort');
 assert.equal(calls.length,0);
 let requests=0; s.fetcher=async()=>{requests++;return new Response('data: '+JSON.stringify({type:'response.output_item.added',output_index:0,item:{type:'function_call',id:'f',call_id:'c',name:'echo',arguments:''}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});};
 const events=[]; await assert.rejects(()=>s.responses({model:'chosen',input:'hi'},{onEvent:e=>events.push(e)}));
 assert.equal(requests,1);assert.equal(events.length,1);assert.equal(s.traffic.at(-1).status,'failed');
});
test('request identity and account snapshot survive completion and unknown usage stays unknown',async t=>{
 const {s}=await setup(t);
 await s.responses({model:'chosen',input:'hi'},{requestContext:{id:'req-fixture',accountKey:'a',credentialRevision:3}});
 assert.equal(s.traffic.at(-1).id,'req-fixture');assert.equal(s.traffic.at(-1).account,'a');assert.equal(s.traffic.at(-1).usage.inputTokens,null);
});
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "modelbridge-independent-"));
  t.after(async () => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + "\\"));
    await rm(dir, { recursive: true });
  });
  const calls = [];
  const s = new StandaloneService({
    dataDir: dir,
    fetcher: async (url, o = {}) => {
      calls.push({ url, body: o.body && JSON.parse(o.body) });
      if (url.endsWith("/models"))
        return Response.json({
          models: [{ slug: "chosen", visibility: "list" }],
        });
      return new Response(
        "data: " +
          JSON.stringify({
            type: "response.completed",
            response: {
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "OK" }],
                },
              ],
            },
          }) +
          "\n\n",
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  s.vault = {
    active: "a",
    accounts: {
      a: {
        access_token: "SECRET_TOKEN",
        expiresAt: Date.now() + 3600000,
        scopes: ["chatgpt.tokens.use.direct"],
      },
    },
  };
  s.models = [model];
  s.upstreamModels = [model];
  return { s, calls, dir };
}
test("standalone inference only calls the official membership endpoint and does not expose credentials", async (t) => {
  const { s, calls } = await setup(t);
  const r = await s.chat({
    model: "chosen",
    messages: [{ role: "user", content: "PRIVATE_PROMPT" }],
  });
  assert.equal(r.choices[0].message.content, "OK");
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(s.status().engine.mode, "standalone");
  assert.equal(s.status().traffic[0].httpStatus, 200);
  assert.ok(!JSON.stringify(s.status()).includes("SECRET_TOKEN"));
  assert.ok(!JSON.stringify(s.status()).includes("PRIVATE_PROMPT"));
});
test("model rules enforce exact aliases, stale forms and report context isolation", async (t) => {
  const { s, calls } = await setup(t);
  const old = s.modelRules();
  s.reports = [{ status: "passed" }];
  await s.saveModelRules({
    kind: "aliases",
    revision: old.revision,
    values: [{ name: "chosen", alias: "my-model", fork: false }],
  });
  assert.equal(s.models.find((m) => m.slug === "chosen").selectable, false);
  assert.equal(s.reports.length, 0);
  const r = await s.chat({
    model: "my-model",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(r.model, "my-model");
  assert.equal(calls[0].body.model, "chosen");
  await assert.rejects(
    () => s.chat({ model: "chosen", messages: [] }),
    /not selectable/,
  );
  await assert.rejects(
    () =>
      s.saveModelRules({
        kind: "excluded",
        revision: old.revision,
        values: [],
      }),
    /规则已变化/,
  );
  await assert.rejects(
    () =>
      s.saveModelRules({
        kind: "aliases",
        revision: s.modelRules().revision,
        values: [{ name: "chosen", alias: "chosen", fork: true }],
      }),
    /别名无效/,
  );
});
test("settings persist, reject stale writes, and guard active requests", async (t) => {
  const { s, dir } = await setup(t);
  const old = s.settings();
  await s.updateSettings({ ...old, timeoutSeconds: 60 });
  assert.equal(s.timeoutSeconds, 60);
  assert.equal(
    JSON.parse(await readFile(join(dir, "settings.json"), "utf8"))
      .values.timeoutSeconds,
    60,
  );
  await assert.rejects(
    () => s.updateSettings({ ...old, timeoutSeconds: 70 }),
    /设置已变化/,
  );
  s.gatewayActive = 1;
  await assert.rejects(
    () => s.updateSettings({ ...s.settings(), timeoutSeconds: 80 }),
    /等待/,
  );
});
test("account disabling does not silently switch accounts and quota stays explicitly unknown", async (t) => {
  const { s } = await setup(t);
  s.vault.accounts.b = { ...s.vault.accounts.a };
  await s.accountAction("a", "disable");
  assert.equal(s.vault.active, null);
  assert.equal(s.models.length, 0);
  assert.equal((await s.quota("a")).status, "authorization_required");
  await assert.rejects(() => s.selectAccount("a"), /启用/);
  await s.selectAccount("b");
  assert.equal(s.vault.active, "b");
  assert.equal(s.models[0].slug, "chosen");
});
test("authorization and discovery cannot overlap with account changes", async (t) => {
  const { s, calls } = await setup(t);
  s.pending = { expiresAt: Date.now() + 10000 };
  await assert.rejects(
    () => s.refreshCatalog(),
    (e) => e.details.httpStatus === 409,
  );
  assert.equal(calls.length, 0);
  s.pending = null;
  s.mutating = true;
  await assert.rejects(
    () => s.chat({ model: "chosen", messages: [] }),
    (e) => e.details.httpStatus === 409,
  );
  assert.throws(
    () => s.cancelLogin(),
    (e) => e.details.httpStatus === 409,
  );
  s.mutating = false;
  s.refreshing = Promise.resolve();
  await assert.rejects(
    () => s.finishLogin(new URLSearchParams()),
    (e) => e.details.httpStatus === 409,
  );
});
test("HTTP preserves network/timeout/upstream codes and logs unknown model rejections", async (t) => {
  const { s } = await setup(t);
  const server = createApp({
    service: s,
    controlKey: "control",
    gatewayKey: "gateway",
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
  const send = (model) =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer gateway",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "PRIVATE" }],
      }),
    });
  assert.equal((await send("unknown")).status, 400);
  assert.equal(s.traffic.at(-1).model, "unknown");
  for (const [error, status] of [
    [new TypeError("fetch failed"), 502],
    [new DOMException("timeout", "TimeoutError"), 504],
  ]) {
    s.fetcher = async () => {
      throw error;
    };
    assert.equal((await send("chosen")).status, status);
    assert.equal(s.traffic.at(-1).httpStatus, status);
  }
  s.fetcher = async () =>
    Response.json({ error: { code: "quota_exceeded" } }, { status: 429 });
  assert.equal((await send("chosen")).status, 429);
  assert.equal(s.traffic.at(-1).httpStatus, 429);
  assert.ok(!JSON.stringify(s.traffic).includes("PRIVATE"));
});
test("Responses rejects stored state and keeps alias identity in stream and result", async (t) => {
  const { s } = await setup(t);
  await s.saveModelRules({
    kind: "aliases",
    revision: s.modelRules().revision,
    values: [{ name: "chosen", alias: "alias", fork: true }],
  });
  const events = [];
  const r = await s.responses(
    { model: "alias", input: "hi" },
    { onEvent: (e) => events.push(e) },
  );
  assert.equal(r.model, "alias");
  assert.equal(events.at(-1).response.model, "alias");
  assert.equal(s.traffic.at(-1).path, "/v1/responses");
  await assert.rejects(
    () => s.responses({ model: "alias", input: "hi", store: true }),
    /无存储/,
  );
  await assert.rejects(
    () => s.responses({ model: "alias", previous_response_id: "r" }),
    /无存储/,
  );
});
