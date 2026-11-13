import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { loadVault, saveVault } from "./vault.mjs";
import {
  validateEngineConfig,
  localFetch,
  engineError,
  readChat,
} from "./engine-client.mjs";
import { managementMethods } from "./engine-management.mjs";
import { runProbe } from "./probe-jobs.mjs";
export { validateEngineConfig } from "./engine-client.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const publicError = (e) => ({
  message:
    e.name === "AbortError"
      ? "操作已取消"
      : e.name === "TimeoutError"
        ? "请求超时"
        : e.details
          ? e.message
          : "引擎连接失败，请检查本机服务与密钥",
  code: e.details?.code || "engine_unavailable",
});
export class EngineService {
  constructor({ dataDir, fetcher = localFetch }) {
    this.dataDir = dataDir;
    this.fetcher = fetcher;
    this.config = null;
    this.models = [];
    this.accounts = [];
    this.reports = [];
    this.traffic = [];
    this.gatewayActive = 0;
    this.job = null;
    this.pending = null;
    this.reachable = false;
    this.catalogAt = null;
    this.lastError = null;
    this.refreshing = null;
    this.lastPoll = 0;
    this.context = null;
    this.stateWrite = Promise.resolve();
  }
  async init() {
    await mkdir(this.dataDir, { recursive: true });
    this.quotas = new Map();
    this.privateAccounts = new Map();
    try {
      const prefs = JSON.parse(
        await readFile(join(this.dataDir, "preferences.json"), "utf8"),
      );
      if (
        Number.isInteger(prefs.timeoutSeconds) &&
        prefs.timeoutSeconds >= 30 &&
        prefs.timeoutSeconds <= 600
      )
        this.timeoutSeconds = prefs.timeoutSeconds;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    try {
      this.traffic = JSON.parse(
        await readFile(join(this.dataDir, "engine-traffic.json"), "utf8"),
      ).slice(-100);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    try {
      this.config = validateEngineConfig(
        await loadVault(join(this.dataDir, "engine.dpapi")),
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    try {
      this.saved = JSON.parse(
        await readFile(join(this.dataDir, "engine-reports.json"), "utf8"),
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (this.config) await this.refreshCatalog().catch(() => {});
  }
  async request(
    path,
    { config = this.config, management = false, signal, ...options } = {},
  ) {
    if (!config)
      throw engineError("请先连接 CLIProxyAPI", "engine_not_configured", 503);
    const bounded = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(
        management ? 15000 : (this.timeoutSeconds || 180) * 1000,
      ),
    ]);
    try {
      const response = await this.fetcher(config.baseUrl + path, {
        ...options,
        redirect: "error",
        signal: bounded,
        headers: {
          ...options.headers,
          Authorization:
            "Bearer " + (management ? config.managementKey : config.apiKey),
        },
      });
      if (management && response.headers.get("x-cpa-version"))
        this.version = response.headers.get("x-cpa-version");
      return response;
    } catch (e) {
      if (signal?.aborted) throw e;
      throw engineError(
        e.name === "TimeoutError"
          ? "本机引擎请求超时"
          : "无法连接本机 CLIProxyAPI",
        "engine_unavailable",
        e.name === "TimeoutError" ? 504 : 502,
      );
    }
  }
  async json(path, options = {}) {
    const r = await this.request(path, options);
    if (!r.ok) {
      await r.body?.cancel();
      throw engineError(
        `引擎返回 HTTP ${r.status}；请检查服务和密钥`,
        "engine_management_error",
        502,
      );
    }
    try {
      return await r.json();
    } catch {
      throw engineError("引擎返回的数据无法解析", "invalid_engine_response");
    }
  }
  async discover(config) {
    const [catalog, accounts, engineConfig] = await Promise.all([
      this.json("/v1/models", { config }),
      this.json("/v0/management/auth-files", { config, management: true }),
      this.json("/v0/management/config", { config, management: true }),
    ]);
    if (!Array.isArray(catalog.data) || !Array.isArray(accounts.files))
      throw engineError("引擎目录格式不匹配", "invalid_engine_catalog");
    const providerFields = [
      "codex-api-key",
      "claude-api-key",
      "gemini-api-key",
      "xai-api-key",
      "meta-api-key",
      "vertex-api-key",
      "interactions-api-key",
      "openai-compatibility",
    ];
    if (
      accounts.files.some((a) => a.provider !== "codex") ||
      providerFields.some(
        (k) => Array.isArray(engineConfig[k]) && engineConfig[k].length,
      )
    )
      throw engineError(
        "请连接仅配置 Codex OAuth 的 CLIProxyAPI 实例；当前实例包含其他账号或 API 提供商",
        "codex_only_required",
        409,
      );
    const models = [];
    const seen = new Set();
    for (const row of catalog.data) {
      if (
        typeof row.id !== "string" ||
        !row.id ||
        row.id.length > 256 ||
        seen.has(row.id)
      )
        continue;
      seen.add(row.id);
      const image = /^gpt-image(?:-|$)/.test(row.id) || row.type === "image";
      models.push({
        slug: row.id,
        displayName: row.id,
        kind: image ? "image" : "text",
        owner: typeof row.owned_by === "string" ? row.owned_by : "unknown",
        selectable: !image,
        visibility: "engine",
        declared: {},
        source: "CLIProxyAPI",
      });
    }
    const codex = accounts.files.filter((a) => a.provider === "codex");
    const privateAccounts = new Map();
    const safeAccounts = codex.map((a, index) => {
      const key = hash(String(a.id || a.name || index)).slice(0, 16);
      privateAccounts.set(key, a);
      return {
        key,
        label: `Codex ${index + 1} · ${key.slice(0, 6)}`,
        provider: "codex",
        status: ["active", "error", "disabled", "pending"].includes(a.status)
          ? a.status
          : "unknown",
        disabled: a.disabled === true,
        unavailable: a.unavailable === true,
      };
    });
    return {
      models,
      accounts: safeAccounts,
      privateAccounts,
      context: hash(
        config.baseUrl +
          "\0" +
          config.apiKey +
          "\0" +
          safeAccounts
            .map((a) => a.key + ":" + a.disabled)
            .sort()
            .join(","),
      ),
    };
  }
  applyDiscovery(data) {
    if (this.context !== data.context) {
      this.reports =
        this.saved?.context === data.context &&
        Array.isArray(this.saved.reports)
          ? this.saved.reports.slice(-100)
          : [];
      this.context = data.context;
    }
    this.privateAccounts = data.privateAccounts;
    this.quotas ??= new Map();
    this.models = data.models;
    this.accounts = data.accounts;
    this.reachable = true;
    this.catalogAt = new Date().toISOString();
    this.lastPoll = Date.now();
    this.lastError = null;
  }
  async connect(value) {
    if (
      this.job ||
      this.gatewayActive ||
      this.pending ||
      this.refreshing ||
      this.connecting ||
      this.mutating
    )
      throw engineError("请等待当前操作结束", "busy", 409);
    this.connecting = true;
    try {
      const config = validateEngineConfig(value);
      const data = await this.discover(config);
      await mkdir(this.dataDir, { recursive: true });
      await saveVault(join(this.dataDir, "engine.dpapi"), config);
      this.config = config;
      this.applyDiscovery(data);
      this.quotas = new Map();
      return this.status();
    } finally {
      this.connecting = false;
    }
  }
  async refreshCatalog() {
    if (this.connecting)
      throw engineError("正在连接引擎，请稍后刷新", "busy", 409);
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const data = await this.discover(this.config);
        this.applyDiscovery(data);
        return this.models;
      } catch (e) {
        this.reachable = false;
        this.lastPoll = Date.now();
        this.lastError = publicError(e);
        throw e;
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
  async poll() {
    if (this.connecting || this.mutating) return;
    if (this.pending) {
      if (this.pending.expires < Date.now()) {
        this.pending = null;
        this.lastError = {
          message: "登录等待超时，请重新发起",
          code: "login_timeout",
        };
      } else
        try {
          const result = await this.json(
            "/v0/management/get-auth-status?state=" +
              encodeURIComponent(this.pending.state),
            { management: true },
          );
          if (result.status === "ok") {
            this.pending = null;
            await this.refreshCatalog();
          } else if (result.status === "error") {
            this.pending = null;
            this.lastError = {
              message: "授权未完成，请重试登录",
              code: "login_failed",
            };
          }
        } catch (e) {
          this.lastError = publicError(e);
        }
    }
    if (this.config && Date.now() - this.lastPoll > 10000)
      await this.refreshCatalog().catch(() => {});
  }
  status() {
    return {
      name: "模型桥 ModelBridge",
      phase: "CLIProxyAPI 本机网关",
      engine: {
        name: "CLIProxyAPI",
        version: this.version || null,
        configured: !!this.config,
        reachable: this.reachable,
        baseUrl: this.config?.baseUrl || null,
        managementUrl: this.config
          ? this.config.baseUrl + "/management.html"
          : null,
        mode: "external",
        policy:
          "请求由 CLIProxyAPI 处理；参数兼容转换遵循引擎配置，ModelBridge 不改模型、不自动重试。",
      },
      account: {
        connected: this.accounts.some(
          (a) => !a.disabled && a.status === "active",
        ),
        planEnabled:
          this.reachable &&
          this.accounts.some((a) => !a.disabled && a.status === "active"),
      },
      accounts: this.accounts.map((a) => ({
        ...a,
        quota: this.quotas?.get(a.key) || null,
      })),
      models: this.models.map((m) => ({
        ...m,
        checks: Object.fromEntries(
          ["text", "tools", "files", "mcp", "long"].map((kind) => [
            kind,
            this.reports.findLast(
              (r) => r.model === m.slug && r.kind === kind,
            ) || { status: "unverified" },
          ]),
        ),
      })),
      catalogAt: this.catalogAt,
      catalogStale: !this.reachable,
      loginPending: !!this.pending,
      busy: this.job ? { model: this.job.model, kind: this.job.kind } : null,
      gatewayActive: this.gatewayActive,
      reports: this.reports,
      traffic: this.traffic,
      lastError: this.lastError,
      limits:
        "目录来自当前引擎，不等于全部能力已验证。图像条目仅展示。工具由调用客户端执行，测试会消耗少量会员用量。",
    };
  }
  async startLogin() {
    if (this.pending || this.job || this.connecting || this.mutating)
      throw engineError("已有登录或测试正在进行", "busy", 409);
    this.mutating = true;
    try {
      const data = await this.json(
        "/v0/management/codex-auth-url?is_webui=true",
        { management: true },
      );
      let url;
      try {
        url = new URL(data.url);
      } catch {
        throw engineError("引擎没有返回有效登录地址", "invalid_login_url");
      }
      if (
        url.protocol !== "https:" ||
        url.hostname !== "auth.openai.com" ||
        url.username ||
        url.password ||
        typeof data.state !== "string"
      )
        throw engineError("引擎登录地址未通过检查", "invalid_login_url");
      this.pending = { state: data.state, expires: Date.now() + 10 * 60000 };
      return url.href;
    } finally {
      this.mutating = false;
    }
  }
  async forward({ path, method = "POST", body, signal, headers = {} }) {
    if (this.connecting || this.mutating)
      throw engineError("引擎配置正在更新，请稍后重试", "busy", 409);
    if (!this.reachable)
      throw engineError(
        "引擎未连接或配置不符合 Codex OAuth 范围，请刷新连接",
        "engine_not_ready",
        503,
      );
    if (!["/v1/models", "/v1/chat/completions", "/v1/responses"].includes(path))
      throw engineError("此接口暂未接入", "route_not_supported", 404);
    const passed = {};
    for (const name of [
      "content-type",
      "accept",
      "x-session-id",
      "session_id",
      "session-id",
      "x-client-request-id",
      "openai-beta",
    ])
      if (typeof headers[name] === "string") passed[name] = headers[name];
    return this.request(path, { method, body, signal, headers: passed });
  }
  async recordTraffic(entry) {
    this.traffic.push(entry);
    this.traffic = this.traffic.slice(-100);
    const snapshot = JSON.stringify(this.traffic, null, 2);
    this.stateWrite = this.stateWrite
      .catch(() => {})
      .then(() =>
        writeFile(join(this.dataDir, "engine-traffic.json"), snapshot, {
          mode: 0o600,
        }),
      );
    await this.stateWrite;
  }
  async verify(model, kind) {
    if (["files", "mcp", "long"].includes(kind))
      return runProbe.call(this, model, kind);
    if (this.job || this.connecting || this.mutating || this.pending)
      throw engineError("已有操作正在运行", "busy", 409);
    if (
      !this.reachable ||
      !this.models.some((m) => m.slug === model && m.selectable)
    )
      throw engineError("请刷新目录并选择文本模型", "unknown_model", 400);
    if (!["text", "tools"].includes(kind))
      throw engineError("未知测试类型", "invalid_test", 400);
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(120000),
    ]);
    this.job = { model, kind, controller };
    const context = this.context,
      report = {
        model,
        kind,
        engine: "CLIProxyAPI",
        startedAt: new Date().toISOString(),
        status: "failed",
        requests: 0,
        toolCalls: 0,
      };
    const marker = "MB_" + randomBytes(8).toString("hex");
    const messages = [
      {
        role: "user",
        content:
          kind === "text"
            ? `Reply exactly ${marker}.`
            : `Call echo with text ${marker}. After its result reply exactly ${marker}.`,
      },
    ];
    const tools = [
      {
        type: "function",
        function: {
          name: "echo",
          description: "Local test echo without side effects.",
          parameters: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
    ];
    try {
      for (let i = 0; i < 4; i++) {
        report.requests++;
        const response = await this.forward({
          path: "/v1/chat/completions",
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            ...(kind === "tools" ? { tools } : {}),
          }),
        });
        const message = await readChat(response, { signal });
        messages.push(message);
        if (!message.tool_calls?.length) {
          if (
            message.content?.trim() !== marker ||
            (kind === "tools" && !report.toolCalls)
          )
            throw engineError("响应未通过测试结果核对", "probe_mismatch");
          report.status = "passed";
          break;
        }
        if (kind !== "tools")
          throw engineError("文本测试出现了意外工具调用", "unexpected_tool");
        for (const call of message.tool_calls) {
          const args = JSON.parse(call.function.arguments);
          if (
            call.function.name !== "echo" ||
            args.text !== marker ||
            typeof call.id !== "string" ||
            !call.id
          )
            throw engineError("工具参数未通过核对", "invalid_tool_call");
          report.toolCalls++;
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ text: args.text }),
          });
        }
      }
      if (report.status !== "passed")
        throw engineError("工具测试超过最大回合", "round_limit");
      this.lastError = null;
    } catch (e) {
      report.status = signal.aborted ? "cancelled_or_timeout" : "failed";
      report.error = publicError(e);
      this.lastError = report.error;
    } finally {
      report.finishedAt = new Date().toISOString();
      try {
        if (this.context === context) {
          this.reports.push(report);
          this.reports = this.reports.slice(-100);
          this.saved = { context, reports: this.reports };
          await writeFile(
            join(this.dataDir, "engine-reports.json"),
            JSON.stringify(this.saved, null, 2),
            { mode: 0o600 },
          );
        }
      } finally {
        this.job = null;
      }
    }
    return report;
  }
  cancel() {
    this.job?.controller.abort();
  }
  async savePreferences() {
    await writeFile(
      join(this.dataDir, "preferences.json"),
      JSON.stringify({ timeoutSeconds: this.timeoutSeconds }),
      { mode: 0o600 },
    );
  }
}
Object.assign(EngineService.prototype, managementMethods);
