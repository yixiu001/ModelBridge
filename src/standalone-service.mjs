import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { BridgeService, safeError } from "./service.mjs";
import { saveVault } from "./vault.mjs";
import {
  RESOURCE,
  TOKEN_ENDPOINT,
  DIRECT_SCOPE,
  acceptCallback,
  validateIdToken,
} from "./auth.mjs";
import {
  beginQuotaLogin,
  listenQuotaCallback,
  CODEX_CLIENT,
  CODEX_TOKEN,
} from "./quota-auth.mjs";
import {
  normalizeCatalog,
  requireModel,
  readResponseStream,
} from "./protocol.mjs";
import { runProbe } from "./probe-jobs.mjs";
import { parseCodexQuota } from "./vendor/codex-quota.mjs";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, settingsSnapshot, previewSettings, exportSettings, restoreSettings } from "./settings-store.mjs";
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const fail = (message, code = "invalid_input", httpStatus = 400) => {
  const e = new Error(message);
  e.details = { code, httpStatus };
  throw e;
};
export class StandaloneService extends BridgeService {
  constructor(options) {
    super(options);
    this.direct = true;
    this.timeoutSeconds = 180;
    this.traffic = [];
    this.quotas = new Map();
    this.quotaListener = options.quotaListener || listenQuotaCallback;
    this.upstreamModels = [];
    this.prefs = structuredClone(DEFAULT_SETTINGS);
    this.writeQueue = Promise.resolve();
    this.reportFile = "direct-reports.json";
  }
  async read(name, fallback) {
    try {
      return JSON.parse(await readFile(join(this.dataDir, name), "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      return fallback;
    }
  }
  async save(name, data) {
    const value = JSON.stringify(data, null, 2);
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const path = join(this.dataDir, name),
          tmp = path + "." + randomUUID() + ".tmp";
        await writeFile(tmp, value, { mode: 0o600 });
        await rename(tmp, path);
      });
    return this.writeQueue;
  }
  async init() {
    await super.init();
    this.prefs = (await loadSettings(this.dataDir)).values;
    this.timeoutSeconds = this.prefs.timeoutSeconds;
    this.traffic = await this.read("direct-traffic.json", []);
    await this.loadReports();
    if (this.account && !this.account.disabled)
      await this.refreshCatalog().catch((e) => {
        this.lastError = safeError(e);
      });
  }
  get context() {
    return hash({
      version: 3,
      account: this.vault.active,
      excluded: this.prefs?.excluded,
      aliases: this.prefs?.aliases,
    });
  }
  get reachable() {
    return !!this.account && !this.account.disabled && this.models.length > 0;
  }
  idle() {
    if (
      this.job ||
      this.gatewayActive ||
      this.mutating ||
      this.quotaReading ||
      this.refreshPromise ||
      this.refreshing ||
      this.pending
    )
      fail("请等待当前调用或授权完成", "busy", 409);
  }
  async loadReports() {
    const data = await this.read("direct-reports.json", {});
    this.reports = data.context === this.context ? data.reports : [];
  }
  async poll() {
    if (this.pending?.expiresAt < Date.now()) {
      this.closeQuotaCallback();
      this.pending = null;
      this.lastError = {
        code: "login_expired",
        message: "登录等待已过期，请重新开始",
      };
    }
  }
  status() {
    const old = super.status();
    return {
      ...old,
      phase: "独立 Codex OAuth 网关",
      engine: {
        name: "ModelBridge",
        version: "0.3.1",
        mode: "standalone",
        configured: !!this.account,
        reachable: this.reachable,
        baseUrl: RESOURCE,
        policy:
          "ModelBridge 直接请求会员通道；指定模型不替换，失败不自动重试。",
      },
      accounts: Object.entries(this.vault.accounts).map(([key, a]) => ({
        key,
        label: `账号 ${key.slice(0, 8)}`,
        active: key === this.vault.active,
        disabled: !!a.disabled,
        status: a.scopes?.includes(DIRECT_SCOPE) ? "active" : "error",
        note: a.note || "",
        priority: a.priority || 0,
        lastRefresh: a.lastRefresh || null,
        updatedAt: a.updatedAt || null,
        successCount: this.traffic.filter(
          (t) => t.account === key && t.status === "forwarded",
        ).length,
        failureCount: this.traffic.filter(
          (t) => t.account === key && t.status === "failed",
        ).length,
        quota: this.quotas.get(key) || {
          status: a.quotaAuth ? "unqueried" : "authorization_required",
          message: a.quotaAuth
            ? "尚未查询，请刷新配额"
            : "请先授权读取配额，使用与当前账号相同的 ChatGPT 账号登录。",
          checkedAt: null,
        },
      })),
      traffic: this.traffic,
      loginExpiresAt: this.pending?.expiresAt,
      quotaLoginPending: this.pending?.purpose === "quota",
      models: this.models.map((m) => ({
        ...m,
        checks: Object.fromEntries(
          ["text", "tools", "files", "mcp", "long"].map((k) => [
            k,
            this.reports.findLast(
              (r) => r.model === m.slug && r.kind === k,
            ) || { status: "unverified" },
          ]),
        ),
      })),
      busy: this.job
        ? {
            model: this.job.model,
            kind: this.job.kind,
            progress: this.job.progress,
          }
        : null,
    };
  }
  async accessToken() {
    if (this.account?.disabled)
      fail("当前账号已停用，请选择启用的账号", "account_disabled", 409);
    return super.accessToken();
  }
  async refreshCatalog({ internal = false } = {}) {
    if ((this.mutating || this.pending) && !internal)
      fail("管理操作进行中", "busy", 409);
    if (this.refreshing) return this.refreshing;
    if (this.job) fail("验证进行中", "busy", 409);
    this.refreshing = (async () => {
      const token = await this.accessToken();
      this.upstreamModels = normalizeCatalog(
        await this.json(RESOURCE + "/models", {
          headers: { Authorization: "Bearer " + token },
        }),
      );
      this.applyRules();
      this.catalogAt = new Date().toISOString();
      this.lastError = null;
      return this.models;
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
  applyRules() {
    const { excluded, aliases } = this.prefs;
    this.models = this.upstreamModels.map((m) => ({
      ...m,
      selectable:
        m.selectable &&
        !excluded.includes(m.slug) &&
        !aliases.some((a) => a.name === m.slug && !a.fork),
    }));
    for (const a of aliases) {
      const m = this.upstreamModels.find((m) => m.slug === a.name);
      if (m)
        this.models.push({
          ...m,
          slug: a.alias,
          displayName: a.alias + " → " + a.name,
          upstreamModel: a.name,
          selectable:
            m.selectable &&
            !excluded.includes(a.name) &&
            !excluded.includes(a.alias),
        });
    }
  }
  async finishLogin(query) {
    if (this.mutating || this.refreshing || this.refreshPromise)
      fail("授权正在处理", "busy", 409);
    this.mutating = true;
    try {
      if (this.pending?.purpose === "quota")
        return await this.finishQuotaLogin(query);
      await super.finishLogin(query);
      await this.loadReports();
      await this.refreshCatalog({ internal: true });
    } finally {
      this.mutating = false;
    }
  }
  startLogin(uri, newAccount = true) {
    this.idle();
    return super.startLogin(uri, newAccount);
  }
  cancelLogin() {
    if (this.mutating) fail("正在完成授权，请稍候", "busy", 409);
    this.closeQuotaCallback();
    this.pending = null;
    return { ok: true };
  }
  async submitLoginCallback(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      fail("回调地址格式无效");
    }
    if (!this.pending || url.origin + url.pathname !== this.pending.redirectUri)
      fail("回调地址与本次授权不匹配");
    await this.finishLogin(url.searchParams);
    return { ok: true };
  }
  async selectAccount(key) {
    this.idle();
    if (this.vault.accounts[key]?.disabled) fail("请先启用该账号");
    this.mutating = true;
    try {
      await super.selectAccount(key);
      this.upstreamModels = [];
      await this.loadReports();
      await this.refreshCatalog({ internal: true });
      return { ok: true };
    } finally {
      this.mutating = false;
    }
  }
  async accountAction(key, action) {
    this.idle();
    const a = this.vault.accounts[key];
    if (!a) fail("账号不存在");
    if (action === "select") return this.selectAccount(key);
    if (!["enable", "disable", "remove", "refresh"].includes(action))
      fail("未知账号操作");
    this.mutating = true;
    try {
      const next = structuredClone(this.vault);
      if (action === "refresh") {
        const tokens = await this.json(TOKEN_ENDPOINT, {
          method: "POST",
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: a.client_id,
            refresh_token: a.refresh_token,
            resource: RESOURCE,
          }),
        });
        this.validateTokens(tokens);
        Object.assign(next.accounts[key], {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || a.refresh_token,
          scopes:
            typeof tokens.scope === "string"
              ? tokens.scope.split(/\s+/)
              : a.scopes,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          lastRefresh: new Date().toISOString(),
        });
      } else if (action === "remove") delete next.accounts[key];
      else next.accounts[key].disabled = action === "disable";
      if (next.active === key && (action === "remove" || action === "disable"))
        next.active = null;
      await saveVault(this.vaultPath, next);
      this.vault = next;
      if (next.active !== key || action !== "refresh") {
        this.models = [];
        this.upstreamModels = [];
      }
      await this.loadReports();
      if (this.account && !this.account.disabled)
        await this.refreshCatalog({ internal: true });
      return { ok: true };
    } finally {
      this.mutating = false;
    }
  }
  async accountsBatch(keys, action) {
    if (
      !Array.isArray(keys) ||
      !keys.length ||
      keys.length > 50 ||
      new Set(keys).size !== keys.length ||
      !["enable", "disable", "refresh"].includes(action)
    )
      fail("批量操作无效");
    const results = [];
    for (const key of keys) {
      try {
        await this.accountAction(key, action);
        results.push({ key, ok: true });
      } catch (e) {
        results.push({ key, ok: false, message: safeError(e).message });
      }
    }
    return { results };
  }
  async updateAccount(key, fields) {
    this.idle();
    if (
      !this.vault.accounts[key] ||
      !fields ||
      Object.keys(fields).some((k) => !["note", "priority"].includes(k)) ||
      typeof fields.note !== "string" ||
      fields.note.length > 200 ||
      !Number.isInteger(fields.priority) ||
      Math.abs(fields.priority) > 1000
    )
      fail("账号备注或排序无效");
    this.mutating = true;
    try {
      const next = structuredClone(this.vault);
      Object.assign(next.accounts[key], fields, {
        updatedAt: new Date().toISOString(),
      });
      await saveVault(this.vaultPath, next);
      this.vault = next;
      return { ok: true };
    } finally {
      this.mutating = false;
    }
  }
  async accountModels(key) {
    if (key !== this.vault.active) fail("请先切换到该账号，再读取其模型");
    await this.refreshCatalog();
    return {
      models: this.models.map((m) => ({
        id: m.slug,
        displayName: m.displayName,
      })),
    };
  }
  async quota(key) {
    this.idle();
    const account = this.vault.accounts[key];
    if (!account) fail("账号不存在");
    this.mutating = true;
    this.quotaReading = true;
    let result;
    try {
      let grant = account.quotaAuth;
      if (!grant)
        return this.setQuota(key, {
          status: "authorization_required",
          message: "请先授权读取配额，使用与当前账号相同的 ChatGPT 账号登录。",
        });
      if (grant.expiresAt <= Date.now() + 60000) {
        const tokens = await this.json(CODEX_TOKEN, {
          method: "POST",
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: CODEX_CLIENT,
            refresh_token: grant.refresh_token,
          }),
        });
        this.validateTokens(tokens);
        const next = structuredClone(this.vault);
        grant = {
          ...grant,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || grant.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
        };
        next.accounts[key].quotaAuth = grant;
        await saveVault(this.vaultPath, next);
        this.vault = next;
      }
      // Credential writes are complete. The read must not block model requests;
      // quotaReading still fences account removal/switching until it finishes.
      this.mutating = false;
      const response = await this.fetcher(
        "https://chatgpt.com/backend-api/wham/usage",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer " + grant.access_token,
            "Chatgpt-Account-Id": grant.accountId,
            Accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        result = {
          status: [401, 403].includes(response.status)
            ? "authorization_required"
            : "error",
          httpStatus: response.status,
          message: [401, 403].includes(response.status)
            ? "配额授权已失效或无权访问，请重新授权读取配额。"
            : `官方配额查询失败（${response.status}），请稍后刷新。`,
        };
      } else
        result = {
          status: "available",
          ...parseCodexQuota(await response.json()),
        };
    } catch (e) {
      const status = e.details?.httpStatus;
      result = {
        status: [400, 401, 403].includes(status)
          ? "authorization_required"
          : "error",
        message: [400, 401, 403].includes(status)
          ? "配额授权刷新失败，请重新授权读取配额。"
          : "配额查询失败：网络异常、超时或官方未返回有效额度窗口。",
      };
    } finally {
      this.mutating = false;
      this.quotaReading = false;
    }
    return this.setQuota(key, result);
  }
  setQuota(key, result) {
    const value = { ...result, checkedAt: new Date().toISOString() };
    this.quotas.set(key, value);
    return value;
  }
  closeQuotaCallback() {
    clearTimeout(this.quotaLoginTimer);
    this.quotaCallback?.close();
    this.quotaCallback = null;
  }
  async startQuotaLogin(key, returnBase) {
    this.idle();
    const a = this.vault.accounts[key];
    if (!a?.email) fail("账号缺少身份信息，请先重新登录会员账号");
    const base = new URL(returnBase);
    if (
      base.protocol !== "http:" ||
      base.hostname !== "127.0.0.1" ||
      base.origin !== returnBase
    )
      fail("回调来源无效");
    this.mutating = true;
    try {
      const pending = beginQuotaLogin(key);
      this.quotaCallback = await this.quotaListener(async (query) => {
        try {
          await this.finishLogin(query);
        } catch (e) {
          this.lastError = {
            code: "quota_authorization_failed",
            message: e.message.includes("账号")
              ? e.message
              : "配额授权未通过验证，请取消后重新授权。",
          };
          throw e;
        }
      }, returnBase).catch(() =>
        fail(
          "配额登录需要本机 1455 端口；端口被占用或不可用，请结束其他登录流程后再试。",
          "callback_unavailable",
          409,
        ),
      );
      this.pending = pending;
      this.lastError = null;
      this.quotaLoginTimer = setTimeout(() => {
        if (this.pending === pending) {
          this.pending = null;
          this.closeQuotaCallback();
          this.lastError = {
            code: "login_expired",
            message: "配额授权已过期，请重新开始。",
          };
        }
      }, 600000);
      this.quotaLoginTimer.unref();
      return pending.url;
    } finally {
      this.mutating = false;
    }
  }
  async finishQuotaLogin(query) {
    const pending = this.pending;
    const { code } = acceptCallback(pending, query);
    const target = this.vault.accounts[pending.quotaAccountKey];
    if (!target) fail("目标账号已不存在");
    const tokens = await this.json(CODEX_TOKEN, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CODEX_CLIENT,
        code,
        code_verifier: pending.verifier,
        redirect_uri: pending.redirectUri,
      }),
    });
    this.validateTokens(tokens);
    if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token)
      fail("配额授权未返回刷新凭据");
    const jwks = await this.json(
      "https://auth.openai.com/.well-known/jwks.json",
    );
    const identity = validateIdToken(tokens.id_token, {
      jwks,
      clientId: CODEX_CLIENT,
      nonce: pending.nonce,
      expectedSubject: target.quotaAuth?.subject,
    });
    // The two OAuth clients may issue pairwise subjects. Match verified email,
    // then pin the native subject/account ID on subsequent authorizations.
    const original = JSON.parse(
      Buffer.from(target.id_token.split(".")[1], "base64url").toString(),
    );
    if (
      original.email_verified !== true ||
      identity.email_verified !== true ||
      typeof identity.email !== "string" ||
      identity.email.toLowerCase() !== target.email.toLowerCase()
    )
      fail("登录的 ChatGPT 账号与目标会员账号不一致，请使用同一账号重新授权。");
    const accountId =
      identity["https://api.openai.com/auth"]?.chatgpt_account_id;
    if (
      typeof accountId !== "string" ||
      !accountId ||
      accountId.length > 200 ||
      /[\s\x00-\x1f]/.test(accountId) ||
      (target.quotaAuth?.accountId && target.quotaAuth.accountId !== accountId)
    )
      fail("配额账号标识缺失或已变化，请检查登录账号。");
    const next = structuredClone(this.vault);
    next.accounts[pending.quotaAccountKey].quotaAuth = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      subject: identity.sub,
      accountId,
    };
    await saveVault(this.vaultPath, next);
    this.vault = next;
    this.quotas.delete(pending.quotaAccountKey);
    this.pending = null;
    this.lastError = null;
    this.closeQuotaCallback();
  }
  settingsDocument() { return settingsSnapshot(this.prefs); }
  settings() { return { ...this.prefs, revision: this.settingsDocument().revision }; }
  previewSettings(data) { return previewSettings(this.settingsDocument(), data.values); }
  exportSettings() { return exportSettings(this.settingsDocument()); }
  async restoreSettings(data) {
    this.idle(); this.mutating = true;
    try {
      const snapshot = await restoreSettings(this.dataDir, data);
      this.prefs = snapshot.values; this.timeoutSeconds = this.prefs.timeoutSeconds;
      this.applyRules(); await this.loadReports(); return snapshot;
    } finally { this.mutating = false; }
  }
  async updateSettings(data) {
    this.idle();
    if (data.revision !== this.settingsDocument().revision)
      fail("设置已变化，请保留草稿并重新比较", "stale_config", 409);
    const {revision, values, ...fields} = data;
    const prefs = values ?? {...this.prefs, ...fields};
    this.mutating = true;
    try {
      const snapshot = await saveSettings(this.dataDir, {revision, values:prefs});
      this.prefs = snapshot.values; this.timeoutSeconds = this.prefs.timeoutSeconds;
      this.applyRules(); await this.loadReports();
      return this.settings();
    } finally { this.mutating = false; }
  }
  modelRules() {
    const r = { excluded: this.prefs.excluded, aliases: this.prefs.aliases };
    return { ...r, revision: hash(r) };
  }
  async saveModelRules(data) {
    this.idle();
    if (data.revision !== this.modelRules().revision)
      fail("规则已变化，请重新读取", "stale_config", 409);
    if (
      !["excluded", "aliases"].includes(data.kind) ||
      !Array.isArray(data.values) ||
      data.values.length > 100
    )
      fail("规则格式无效");
    const name = (v) =>
      typeof v === "string" && /^[-a-zA-Z0-9_.]{1,64}$/.test(v);
    if (data.kind === "excluded") {
      if (
        data.values.some((v) => !name(v)) ||
        new Set(data.values).size !== data.values.length
      )
        fail("请使用不重复的精确模型名称，不支持通配符");
    } else {
      const seen = new Set();
      for (const a of data.values) {
        if (
          !a ||
          !name(a.name) ||
          !name(a.alias) ||
          Object.keys(a).some((k) => !["name", "alias", "fork"].includes(k)) ||
          typeof a.fork !== "boolean" ||
          !this.upstreamModels.some((m) => m.slug === a.name && m.selectable) ||
          this.upstreamModels.some((m) => m.slug === a.alias) ||
          seen.has(a.alias)
        )
          fail("别名无效或与已有名称冲突");
        seen.add(a.alias);
      }
    }
    this.mutating = true;
    try {
      const prefs = {
        ...this.prefs,
        [data.kind]: structuredClone(data.values),
      };
      await saveSettings(this.dataDir, {revision:this.settingsDocument().revision,values:prefs});
      this.prefs = prefs;
      this.applyRules();
      await this.loadReports();
      return this.modelRules();
    } finally {
      this.mutating = false;
    }
  }
  async engineLogs() {
    return {
      lines: this.traffic.map(
        (r) =>
          `${r.finishedAt} ${r.status === "failed" ? "ERROR" : "INFO"} ${r.model} HTTP ${r.httpStatus} ${r.errorCode || ""}`,
      ),
      errors: [],
      checkedAt: new Date().toISOString(),
      unavailable: false,
    };
  }
  async recordRejected(error, body, path) {
    if (error.modelbridgeRecorded) return;
    const now = new Date().toISOString();
    await this.recordTrace(
      {
        model:
          typeof body?.model === "string" ? body.model.slice(0, 256) : null,
        path,
        startedAt: now,
        finishedAt: now,
        status: "failed",
        error: safeError(error),
      },
      body || {},
    );
    error.modelbridgeRecorded = true;
  }
  async recordTrace(trace, body) {
    const entry = {
      id: randomUUID(),
      account: this.vault.active,
      path: trace.path || "/v1/chat/completions",
      model: trace.model,
      startedAt: trace.startedAt,
      finishedAt: trace.finishedAt,
      status:
        trace.status === "completed"
          ? "forwarded"
          : trace.error?.code === "cancelled"
            ? "cancelled"
            : "failed",
      httpStatus:
        trace.status === "completed"
          ? 200
          : trace.error?.httpStatus ||
            (trace.error?.code === "timeout" ? 504 : 400),
      requestBytes: Buffer.byteLength(JSON.stringify(body)),
      errorCode: trace.error?.code,
      error: trace.error,
      adjustments: trace.adjustments,
      returnedToolNames: trace.returnedToolNames,
    };
    this.traffic.push(entry);
    this.traffic = this.traffic.slice(-100);
    if (this.prefs.loggingToFile)
      await this.save("direct-traffic.json", this.traffic);
  }
  async chat(body, options = {}) {
    if (
      !body ||
      typeof body !== "object" ||
      !Array.isArray(body.messages) ||
      body.messages.some((m) => !m || typeof m !== "object") ||
      (body.tools !== undefined && !Array.isArray(body.tools))
    )
      fail("请求消息格式无效", "invalid_chat_request");
    if (this.mutating) fail("管理操作进行中", "busy", 409);
    if (!this.models.length) await this.refreshCatalog();
    const selected = requireModel(this.models, body.model);
    const alias = body.model;
    const result = await super.chat(
      { ...body, model: selected.upstreamModel || alias },
      {
        ...options,
        onChunk: options.onChunk
          ? (c) => options.onChunk({ ...c, model: alias })
          : undefined,
      },
    );
    result.model = alias;
    return result;
  }
  async responses(body, { signal, onEvent } = {}) {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      body.store === true ||
      body.previous_response_id
    )
      fail(
        "仅支持客户端携带完整历史的无存储 Responses 请求",
        "unsupported_response_state",
      );
    if (this.mutating || this.pending) fail("管理操作进行中", "busy", 409);
    if (!this.models.length) await this.refreshCatalog();
    const selected = requireModel(this.models, body.model);
    const trace = {
      model: body.model,
      path: "/v1/responses",
      startedAt: new Date().toISOString(),
    };
    this.gatewayActive++;
    try {
      const token = await this.accessToken();
      const bounded = AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(this.timeoutSeconds * 1000),
      ]);
      const response = await readResponseStream(
        await this.fetcher(RESOURCE + "/responses", {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            ...body,
            model: selected.upstreamModel || body.model,
            store: false,
            stream: true,
          }),
          signal: bounded,
        }),
        {
          signal: bounded,
          onEvent: (event) =>
            onEvent?.(
              event.response
                ? {
                    ...event,
                    response: { ...event.response, model: body.model },
                  }
                : event,
            ),
        },
      );
      trace.status = "completed";
      return { ...response, model: body.model };
    } catch (e) {
      trace.status = "failed";
      trace.error = safeError(e);
      e.modelbridgeRecorded = true;
      throw e;
    } finally {
      this.gatewayActive--;
      trace.finishedAt = new Date().toISOString();
      await this.recordTrace(trace, body);
    }
  }

  async verify(model, kind) {
    if (["files", "mcp", "long"].includes(kind))
      return runProbe.call(this, model, kind);
    this.idle();
    requireModel(this.models, model);
    if (!["text", "tools"].includes(kind)) fail("验证类型无效");
    const controller = new AbortController();
    this.job = { model, kind, controller };
    const report = {
      model,
      kind,
      engine: "ModelBridge",
      status: "failed",
      startedAt: new Date().toISOString(),
      requests: 0,
      toolCalls: 0,
    };
    try {
      const messages = [
          {
            role: "user",
            content:
              kind === "tools"
                ? "Call echo with value MODELBRIDGE_OK, then reply exactly with the returned value."
                : "Reply exactly MODELBRIDGE_OK.",
          },
        ],
        tools =
          kind === "tools"
            ? [
                {
                  type: "function",
                  function: {
                    name: "echo",
                    description: "Echo the supplied value",
                    parameters: {
                      type: "object",
                      properties: { value: { type: "string" } },
                      required: ["value"],
                      additionalProperties: false,
                    },
                  },
                },
              ]
            : undefined;
      for (let i = 0; i < 4; i++) {
        report.requests++;
        const r = await this.chat(
          { model, messages, ...(tools ? { tools } : {}), stream: true },
          { signal: controller.signal },
        );
        const m = r.choices[0].message;
        if (m.tool_calls?.length) {
          messages.push(m);
          for (const c of m.tool_calls) {
            if (c.function.name !== "echo") fail("意外工具");
            const a = JSON.parse(c.function.arguments);
            messages.push({
              role: "tool",
              tool_call_id: c.id,
              content: String(a.value),
            });
            report.toolCalls++;
          }
        } else {
          if (
            m.content?.trim() !== "MODELBRIDGE_OK" ||
            (kind === "tools" && !report.toolCalls)
          )
            fail("验证结果不符");
          report.status = "passed";
          break;
        }
      }
    } catch (e) {
      report.error = safeError(e);
      report.status = controller.signal.aborted
        ? "cancelled_or_timeout"
        : "failed";
    } finally {
      this.job = null;
      report.finishedAt = new Date().toISOString();
      this.reports.push(report);
      await this.save(this.reportFile, {
        context: this.context,
        reports: this.reports,
      });
    }
    return report;
  }
}
