import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { BridgeService, safeError } from "./service.mjs";
import { saveVault } from "./vault.mjs";
import {
  beginLogin,
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
import { prepareRequest } from "./request-contract.mjs";
import { classifyFailure, normalizedUsage } from "./diagnostics.mjs";
import {projectAccountState} from "./account-state.mjs";
import {QuotaJobs} from "./quota-jobs.mjs";
import {catalogRevision, diffCatalog, previewModelRules, verificationKey} from "./model-catalog.mjs";
import {ActivityStore} from "./activity-store.mjs";
import packageInfo from "../package.json" with {type:"json"};
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
    this.startedAt=new Date().toISOString();
    this.timeoutSeconds = 180;
    this.traffic = [];
    this.quotas = new Map();
    this.quotaJobs=new QuotaJobs({getAccount:key=>this.vault.accounts[key],query:(key,opts)=>this.quota(key,opts),persist:jobs=>this.save('quota-jobs.json',jobs)});
    this.quotaListener = options.quotaListener || listenQuotaCallback;
    this.catalogs = {};
    this.reportHistory = [];
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
    this.quotas=new Map(Object.entries(await this.read('quota-snapshots.json',{})));
    this.quotaJobs.hydrate(await this.read('quota-jobs.json',[]));
    this.catalogs=await this.read("catalog-snapshots.json",{});
    this.activity=new ActivityStore(this.dataDir,()=>this.prefs);await this.activity.init();
    if(!(await this.read('activity-import.json',null))){for(const r of this.traffic)await this.activity.append(r);await this.save('activity-import.json',{completedAt:new Date().toISOString()});}
    this.initialized=true;
    await this.logEvent('service_started');
    await this.loadReports();
    if (this.account && !this.account.disabled)
      await this.refreshCatalog().catch((e) => {
        this.lastError = safeError(e);
      });
  }
  get context() {
    return hash({version:4,account:this.vault.active,credentialRevision:this.account?.credentialRevision||1,catalogRevision:catalogRevision(this.upstreamModels),excluded:this.prefs.excluded,aliases:this.prefs.aliases});
  }
  reportKey(model,scenario){return verificationKey({accountKey:this.vault.active,credentialRevision:this.account?.credentialRevision||1,catalogRevision:catalogRevision(this.upstreamModels),rulesRevision:this.modelRules().revision,adapterVersion:4,model,scenario});}
  async saveReport(report){
    const value={...report,context:report.context||this.context,verificationKey:report.verificationKey||this.reportKey(report.model,report.kind)};
    this.reportHistory.push(value);this.reportHistory=this.reportHistory.slice(-1000);
    this.reports=this.reportHistory.filter(r=>r.context===this.context);
    await this.save(this.reportFile,{context:this.context,reports:this.reports,history:this.reportHistory});
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
    this.reportHistory = data.history || (data.reports||[]).map(r=>({...r,context:data.context}));
    this.reports = this.reportHistory.filter(r=>r.context===this.context);
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
        version: packageInfo.version,
        mode: "standalone",
        configured: !!this.account,
        reachable: this.reachable,
        baseUrl: RESOURCE,
        policy:
          "ModelBridge 直接请求会员通道；指定模型不替换，失败不自动重试。",
      },
      catalog: this.catalogs[this.vault.active] || {stale:true,source:RESOURCE+"/models"},
      clientAccess:this.clientAccess?.status(),
      activitySummary: this.activity?.summary({from:new Date(new Date().setHours(0,0,0,0)).toISOString()}),
      storageError:this.storageError,
      reportHistory: this.reportHistory.map(r=>({...r,current:r.context===this.context})),
      quotaJob: this.quotaJobs.read(),
      accounts: Object.entries(this.vault.accounts).map(([key, a]) => ({
        key,
        health: projectAccountState(a,{accountKey:key,inferenceVerifiedAt:this.traffic.findLast(t=>t.account===key&&t.status==='forwarded'&&t.credentialRevision===(a.credentialRevision||1))?.finishedAt,quotaVerifiedAt:this.quotas.get(key)?.status==='available'?this.quotas.get(key)?.checkedAt:this.quotas.get(key)?.previous?.checkedAt}),
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
        quota: this.quotaSnapshot(key) || {
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
      loginPurpose: this.pending?.purpose || "inference",
      loginTarget: this.pending?.targetAccountKey || this.pending?.quotaAccountKey,
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
    const accountKey=this.vault.active, credentialRevision=this.account?.credentialRevision||1;
    const previous=this.catalogs[accountKey];
    if(!this.upstreamModels.length&&previous?.credentialRevision===credentialRevision){this.upstreamModels=previous.models;this.applyRules();}
    this.refreshing = (async () => {
      const token = await this.accessToken();
      const discovered = normalizeCatalog(
        await this.json(RESOURCE + "/models", {
          headers: { Authorization: "Bearer " + token },
        }),
      );
      if(this.vault.active!==accountKey||(this.account?.credentialRevision||1)!==credentialRevision)fail("账号已变化，忽略旧目录","stale_catalog",409);
      const changes=diffCatalog(this.upstreamModels,discovered);
      this.upstreamModels=discovered;
      this.applyRules();
      this.catalogAt = new Date().toISOString();
      this.catalogs[accountKey]={accountKey,credentialRevision,revision:catalogRevision(discovered),models:discovered,source:RESOURCE+'/models',checkedAt:this.catalogAt,stale:false,changes};
      await this.save('catalog-snapshots.json',this.catalogs);
      await this.loadReports();
      this.lastError = null;
      return this.models;
    })().catch(e=>{
      if(this.catalogs[accountKey])this.catalogs[accountKey].stale=true;
      throw e;
    }).finally(() => {
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
  startLogin(uri, newAccount = true, targetAccountKey) {
    this.idle();
    if(targetAccountKey && !this.vault.accounts[targetAccountKey]) fail("账号不存在");
    this.pending=beginLogin({hostId:this.hostId,redirectUri:uri,account:targetAccountKey?this.vault.accounts[targetAccountKey]:newAccount?undefined:this.account});
    this.pending.purpose="inference";this.pending.targetAccountKey=targetAccountKey;
    this.lastError=null;return this.pending.url;
  }
  async refreshAccess() {
    const key=this.vault.active;
    try { return await super.refreshAccess(); }
    catch(e){
      if(this.vault.accounts[key]){
        await this.updateGrant(key,"inference",{refreshError:classifyFailure(e,{stage:"authorize"})});
      }
      throw e;
    }
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
    this.mutating = true;let refreshingGrant=false;
    try {
      const next = structuredClone(this.vault);
      if (action === "refresh") {
        refreshingGrant=true;
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
          refreshError: null,
        });
      } else if (action === "remove") delete next.accounts[key];
      else next.accounts[key].disabled = action === "disable";
      if (next.active === key && (action === "remove" || action === "disable"))
        next.active = null;
      await saveVault(this.vaultPath, next);
      this.vault = next;refreshingGrant=false;
      if (next.active !== key || action !== "refresh") {
        this.models = [];
        this.upstreamModels = [];
      }
      await this.loadReports();
      if (this.account && !this.account.disabled)
        await this.refreshCatalog({ internal: true });
      return { ok: true };
    } catch(error) {
      if(refreshingGrant&&this.vault.accounts[key]){const next=structuredClone(this.vault);next.accounts[key].refreshError=classifyFailure(error,{stage:'authorize'});await saveVault(this.vaultPath,next);this.vault=next;}throw error;
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
  async quota(key, {signal,canCommit=()=>true}={}) {
    this.idle();
    const account = this.vault.accounts[key];
    if (!account) fail("账号不存在");
    this.mutating = true;
    this.quotaReading = true;
    let result,refreshing=false;
    try {
      let grant = account.quotaAuth;
      if (!grant)
        return this.setQuota(key, {
          status: "authorization_required",
          message: "请先授权读取配额，使用与当前账号相同的 ChatGPT 账号登录。",
        });
      if (grant.expiresAt <= Date.now() + 60000) {
        refreshing=true;
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
          lastRefresh: new Date().toISOString(),lastAutomaticRefresh: new Date().toISOString(),refreshError:null,
        };
        next.accounts[key].quotaAuth = grant;
        await saveVault(this.vaultPath, next);
        this.vault = next;refreshing=false;
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
          signal: signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),
        },
      );
      if (!response.ok) {
        if([401,403].includes(response.status)){await this.updateGrant(key,'quota',{refreshError:classifyFailure(Object.assign(new Error('quota authorization'),{details:{httpStatus:response.status,code:'quota_authorization_required',source:'upstream'}}),{stage:'authorize'})},{persist:!!this.initialized});}
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
      if(refreshing){const next=structuredClone(this.vault);next.accounts[key].quotaAuth.refreshError=classifyFailure(e,{stage:'authorize'});if(this.initialized)await saveVault(this.vaultPath,next);this.vault=next;}
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
    if(!canCommit()||signal?.aborted)throw Object.assign(new Error('配额查询已取消'),{name:'AbortError'});
    return this.setQuota(key, result);
  }
  quotaSnapshot(key){
    const q=this.quotas.get(key), a=this.vault.accounts[key];
    if(!q||!a||(q.credentialRevision && q.credentialRevision!==(a.credentialRevision||1))||(q.quotaRevision && q.quotaRevision!==(a.quotaAuth?.credentialRevision||1)))return null;
    return {...q,freshness:q.status==='available'&&Date.now()<q.freshUntil?'current':q.status==='available'||q.previous?'stale':'unavailable'};
  }
  async setQuota(key, result) {
    const previous=this.quotas.get(key), a=this.vault.accounts[key];
    const value={...result,accountKey:key,credentialRevision:a?.credentialRevision||1,quotaRevision:a?.quotaAuth?.credentialRevision||1,checkedAt:new Date().toISOString(),freshUntil:Date.now()+300000};
    if(result.status!=='available'&&previous){value.previous=previous.status==='available'?{windows:previous.windows,planType:previous.planType,creditBalance:previous.creditBalance,checkedAt:previous.checkedAt}:previous.previous;}
    this.quotas.set(key,value);
    if(this.initialized)await this.save('quota-snapshots.json',Object.fromEntries(this.quotas));
    return this.quotaSnapshot(key);
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
    if(this.pending !== pending) fail("本次授权已取消");
    next.accounts[pending.quotaAccountKey].quotaAuth = {
      credentialRevision: (target.quotaAuth?.credentialRevision || 0)+1,
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
  systemInfo(){return {version:packageInfo.version,commit:this.buildCommit||'未提供',mode:'standalone',nodeVersion:process.version,startedAt:this.startedAt,listener:'127.0.0.1',networkMode:process.env.HTTPS_PROXY||process.env.HTTP_PROXY||process.env.ALL_PROXY?'沿用环境代理（凭据隐藏）':'直接连接/系统环境',supported:['Codex OAuth','Chat Completions','无存储 Responses','完整历史工具调用'],unsupported:['自动换号与重试','WebSocket响应链','API提供商','插件','远程管理']};}
  async latestVersion(){
    const r=await this.fetcher('https://api.github.com/repos/yixiu001/ModelBridge/releases/latest',{headers:{Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(r.status===404)return {version:null,message:'本项目尚未发布可查询的Release'};
    if(!r.ok)fail('版本查询失败，请稍后重试','release_query_failed',502);
    const value=await r.json();
    if(typeof value.tag_name!=='string'||value.tag_name.length>60||typeof value.html_url!=='string'||!value.html_url.startsWith('https://github.com/yixiu001/ModelBridge/releases/tag/'))fail('发布信息格式不符');
    return {version:value.tag_name,url:value.html_url};
  }
  settingsDocument() { return settingsSnapshot(this.prefs); }
  settings() { return { ...this.prefs, revision: this.settingsDocument().revision }; }
  previewSettings(data) { return previewSettings(this.settingsDocument(), data.values); }
  exportSettings() { return exportSettings(this.settingsDocument()); }
  async restoreSettings(data) {
    this.idle(); this.mutating = true;
    try {
      const check=this.previewModelRules({rules:data.document?.values});if(check.errors.length)fail(check.errors.join("；"));
      const snapshot = await restoreSettings(this.dataDir, data);
      this.prefs = snapshot.values; this.timeoutSeconds = this.prefs.timeoutSeconds;
      if(this.initialized)await this.activity.expire().catch(()=>{this.storageError="日志清理失败；配置已生效，请检查本机目录权限";});
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
      if(JSON.stringify(prefs.aliases)!==JSON.stringify(this.prefs.aliases)||JSON.stringify(prefs.excluded)!==JSON.stringify(this.prefs.excluded)){const check=this.previewModelRules({rules:prefs});if(check.errors.length)fail(check.errors.join("；"));}
      const snapshot = await saveSettings(this.dataDir, {revision, values:prefs});
      this.prefs = snapshot.values; this.timeoutSeconds = this.prefs.timeoutSeconds;
      if(this.initialized)await this.activity.expire().catch(()=>{this.storageError="日志清理失败；配置已生效，请检查本机目录权限";});
      this.applyRules(); await this.loadReports();
      await this.logEvent("settings_saved");
      return this.settings();
    } finally { this.mutating = false; }
  }
  modelRules() {
    const r = { excluded: this.prefs.excluded, aliases: this.prefs.aliases };
    return { ...r, revision: hash(r) };
  }
  previewModelRules(data) { return previewModelRules({catalog:this.upstreamModels,rules:{excluded:this.prefs.excluded,aliases:this.prefs.aliases,...data.rules}}); }
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
  async recordRejected(error, body, path, requestContext) {
    if (error.modelbridgeRecorded) return;
    const now = new Date().toISOString();
    await this.recordTrace(
      {
        model:
          typeof body?.model === "string" ? body.model.slice(0, 256) : null,
        ...requestContext,
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
  async logEvent(event){
    if(!this.activity)return;
    const now=new Date().toISOString();
    try{await this.activity.append({id:randomUUID(),kind:'system',event,startedAt:now,finishedAt:now,httpStatus:200,status:'forwarded',accountKey:this.vault.active});}
    catch{this.storageError='运行记录保存失败，请检查磁盘与目录权限';}
  }
  async recordTrace(trace, body) {
    const entry = {
      id: trace.id || randomUUID(),
      account: trace.accountKey ?? this.vault.active,
      accountKey: trace.accountKey ?? this.vault.active,
      credentialRevision: trace.credentialRevision ?? this.account?.credentialRevision ?? 1,
      requestedModel: trace.requestedModel || trace.model,
      effectiveModel: trace.model,
      profile: trace.compatibility || "strict",
      usage: normalizedUsage(trace.usage),
      failure: trace.error,
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
    if(this.activity){
      try{await this.activity.append(entry);this.storageError=null;}
      catch{this.storageError='请求摘要保存失败，请检查磁盘与目录权限';}
    } else if (this.prefs.loggingToFile) await this.save("direct-traffic.json", this.traffic);
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
        requestContext: {...options.requestContext, requestedModel:alias},
        onChunk: options.onChunk
          ? (c) => options.onChunk({ ...c, model: alias })
          : undefined,
      },
    );
    result.model = alias;
    return result;
  }
  async responses(body, { signal, onEvent, requestContext } = {}) {
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
    const prepared = prepareRequest({protocol:"responses",body,catalog:this.models});
    const selected = prepared.model;
    const trace = {
      ...requestContext,
      id: requestContext?.id || randomUUID(),
      accountKey: requestContext?.accountKey ?? this.vault.active,
      credentialRevision: requestContext?.credentialRevision ?? this.account?.credentialRevision ?? 1,
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
      trace.usage = response.usage;
      return { ...response, model: body.model };
    } catch (e) {
      trace.status = "failed";
      e.details = classifyFailure(e,{requestId:trace.id,stage:"stream"});
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
      context:this.context,verificationKey:this.reportKey(model,kind),
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
      await this.saveReport(report);
    }
    return report;
  }
}
