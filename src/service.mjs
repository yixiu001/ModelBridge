import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { beginLogin, acceptCallback, validateIdToken, ISSUER, RESOURCE, TOKEN_ENDPOINT, DIRECT_SCOPE } from './auth.mjs';
import { loadVault, saveVault } from './vault.mjs';
import { normalizeCatalog, requireModel, readResponseStream, verifyToolLoop, outputText, httpFailure } from './protocol.mjs';
import { ChatAdapter } from './adapter.mjs';

export function safeError(error) {
  if (error.name === 'AbortError') return { message: '操作已取消', code: 'cancelled' };
  if (error.name === 'TimeoutError') return { message: '请求超时；未自动重试', code: 'timeout' };
  if (error instanceof SyntaxError) return { message: '收到无法解析的数据', code: 'invalid_data' };
  if (error instanceof TypeError) {
    const cause = error.cause?.code;
    return { message: '网络连接或数据格式异常', code: 'network_or_format_error', causeCode: typeof cause === 'string' && /^[A-Z0-9_]{1,80}$/.test(cause) ? cause : undefined };
  }
  return { message: error.message || '操作失败', ...error.details };
}
export class BridgeService {
  constructor({ dataDir, fetcher = fetch }) {
    this.dataDir = dataDir; this.fetcher = fetcher;
    this.vaultPath = join(dataDir, 'accounts.dpapi');
    this.vault = { accounts: {}, active: null };
    this.models = []; this.reports = []; this.catalogAt = null;
    this.pending = null; this.refreshPromise = null; this.job = null; this.lastError = null;
    this.gatewayActive=0;this.toolStates=new Map();this.stateWrite=Promise.resolve();
  }
  async init() {
    await mkdir(this.dataDir, { recursive: true });
    try { this.hostId = JSON.parse(await readFile(join(this.dataDir, 'host.json'), 'utf8')).hostId; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.hostId = `urn:uuid:${randomUUID()}`;
      await writeFile(join(this.dataDir, 'host.json'), JSON.stringify({ hostId: this.hostId }), { flag: 'wx', mode: 0o600 });
    }
    try { this.vault = await loadVault(this.vaultPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await this.loadReports();
    try { this.toolStates=new Map(await loadVault(join(this.dataDir,'tool-states.dpapi'))); }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  async loadReports() {
    this.reports = [];
    if (!this.vault.active) return;
    try {
      const data = JSON.parse(await readFile(join(this.dataDir, 'verification.json'),'utf8'));
      if (data.account === this.vault.active && Array.isArray(data.reports)) this.reports = data.reports;
      // The original verification harness stored a bare array. Import only when
      // exactly one registered account exists, so history cannot cross accounts.
      else if (Array.isArray(data) && Object.keys(this.vault.accounts).length === 1) this.reports = data;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  get account() { return this.vault.accounts[this.vault.active]; }
  status() {
    const account = this.account;
    return {
      name: '模型桥 ModelBridge', phase: '会员接入与 WorkBuddy 联调', gatewayActive:this.gatewayActive,
      account: { connected: Boolean(account?.access_token), planEnabled: Boolean(account?.scopes?.includes(DIRECT_SCOPE)), label: account ? `账号 ${this.vault.active.slice(0,8)}` : null },
      accounts: Object.keys(this.vault.accounts).map(key => ({ key, label: `账号 ${key.slice(0,8)}`, active: key === this.vault.active })),
      loginPending: Boolean(this.pending && !this.pending.used && this.pending.expiresAt > Date.now()),
      models: this.models.map(model => {
        const checks = Object.fromEntries(['text','tools'].map(kind => [kind, this.reports.findLast(r => r.model === model.slug && r.kind === kind) || {status:'unverified'}]));
        return { ...model, checks, verification: Object.values(checks).some(r => r.status === 'passed') ? 'partially_verified' : Object.values(checks).some(r => r.status !== 'unverified') ? 'attempted' : 'unverified' };
      }), catalogAt: this.catalogAt, reports: this.reports,
      busy: this.job ? { model: this.job.model, kind: this.job.kind } : null,
      lastError: this.lastError,
      limits: '当前会员通道不支持托管 MCP、图像生成、Code Interpreter、音视频输入。目录发现不代表能力验证。WorkBuddy 尚未联调。',
    };
  }
  startLogin(redirectUri, newAccount = false) {
    if (this.job || this.refreshPromise || this.gatewayActive) throw new Error('request in progress');
    this.pending = beginLogin({ hostId: this.hostId, redirectUri, account: newAccount ? undefined : this.account });
    this.lastError = null;
    return this.pending.url;
  }
  async json(url, options = {}) {
    const response = await this.fetcher(url, { ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(30_000) });
    if (!response.ok) throw await httpFailure(response);
    return response.json();
  }
  async finishLogin(query) {
    if(this.gatewayActive)throw new Error('request in progress');
    const pending = this.pending;
    const { clientId, code } = acceptCallback(pending, query);
    const tokens = await this.json(TOKEN_ENDPOINT, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri, resource: RESOURCE }) });
    const discovery = await this.json(`${ISSUER}/.well-known/openid-configuration`);
    if (discovery.issuer !== ISSUER || discovery.jwks_uri !== `${ISSUER}/.well-known/jwks.json` || discovery.token_endpoint !== TOKEN_ENDPOINT) throw new Error('unexpected OpenAI discovery endpoints');
    const jwks = await this.json(discovery.jwks_uri);
    const identity = validateIdToken(tokens.id_token, { jwks, clientId, nonce: pending.nonce, expectedSubject: pending.account?.subject });
    this.validateTokens(tokens);
    const key = createHash('sha256').update(`${clientId}\0${identity.sub}`).digest('hex');
    const next = structuredClone(this.vault);
    next.accounts[key] = { client_id: clientId, subject: identity.sub, email: identity.email, issuer: identity.iss, access_token: tokens.access_token, refresh_token: tokens.refresh_token, id_token: tokens.id_token, scopes: typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/) : [], expiresAt: Date.now()+tokens.expires_in*1000 };
    next.active = key;
    await saveVault(this.vaultPath, next);
    this.vault = next; this.pending = null; this.models = []; this.reports = []; this.catalogAt = null; this.lastError = null;
  }
  validateTokens(tokens) {
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || String(tokens.token_type).toLowerCase() !== 'bearer' || typeof tokens.expires_in !== 'number' || tokens.expires_in <= 0) throw new Error('invalid OAuth token response');
  }
  async selectAccount(key) {
    if (this.job || this.pending || this.refreshPromise || this.gatewayActive) throw new Error('request in progress');
    if (!Object.hasOwn(this.vault.accounts,key)) throw new Error('unknown account');
    const next = { ...this.vault, active: key };
    await saveVault(this.vaultPath, next);
    this.vault = next; this.models = []; this.reports = []; this.catalogAt = null;
  }
  async accessToken() {
    const account = this.account;
    if (!account?.access_token) throw new Error('请先登录 ChatGPT');
    if (!account.scopes.includes(DIRECT_SCOPE)) throw new Error('登录成功，但尚未授予会员用量权限');
    if (account.expiresAt > Date.now()+60_000) return account.access_token;
    if (!this.refreshPromise) this.refreshPromise = this.refreshAccess().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }
  async refreshAccess() {
    const account = this.account;
    if (!account.refresh_token) throw new Error('登录已过期，需要重新登录');
    const tokens = await this.json(TOKEN_ENDPOINT, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: account.client_id, refresh_token: account.refresh_token, resource: RESOURCE }) });
    this.validateTokens(tokens);
    const next = structuredClone(this.vault);
    Object.assign(next.accounts[next.active], { access_token: tokens.access_token, refresh_token: tokens.refresh_token || account.refresh_token, scopes: typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/) : account.scopes, expiresAt: Date.now()+tokens.expires_in*1000 });
    await saveVault(this.vaultPath, next);
    this.vault = next;
    if (!this.account.scopes.includes(DIRECT_SCOPE)) throw new Error('会员用量权限已不可用');
    return tokens.access_token;
  }
  async refreshCatalog() {
    if (this.job) throw new Error('verification in progress');
    const token = await this.accessToken();
    const payload = await this.json(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${token}` } });
    this.models = normalizeCatalog(payload); this.catalogAt = new Date().toISOString();
    await writeFile(join(this.dataDir, 'catalog.json'), JSON.stringify({ fetchedAt: this.catalogAt, models: this.models }, null, 2), { mode: 0o600 });
    return this.models;
  }
  async verify(model, kind) {
    if (this.job) throw new Error('verification in progress');
    if (this.pending && !this.pending.used) throw new Error('login in progress');
    requireModel(this.models, model);
    if (!['text','tools'].includes(kind)) throw new Error('unknown verification kind');
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
    this.job = { model, kind, controller };
    const startedAt = new Date().toISOString();
    let report;
    try {
      const token = await this.accessToken();
      const request = async body => readResponseStream(await this.fetcher(`${RESOURCE}/responses`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body), signal }), { signal });
      let result;
      if (kind === 'tools') result = await verifyToolLoop({ model, request, signal });
      else {
        const response = await request({ model, input: [{ role: 'user', content: 'Reply with exactly MODELBRIDGE_OK.' }], store: false, stream: true });
        if (outputText(response).trim() !== 'MODELBRIDGE_OK') throw new Error('text probe did not return expected answer');
        result = { status: 'passed', final: 'MODELBRIDGE_OK', stream: response.stream };
      }
      report = { ...result, model, kind, startedAt, finishedAt: new Date().toISOString() };
      this.lastError = null;
    } catch (error) {
      report = { model, kind, status: signal.aborted ? 'cancelled_or_timeout' : 'failed', startedAt, finishedAt: new Date().toISOString(), error: safeError(error) };
      this.lastError = report.error;
    } finally { this.job = null; }
    this.reports.push(report);
    await writeFile(join(this.dataDir, 'verification.json'), JSON.stringify({ account: this.vault.active, reports: this.reports }, null, 2), { mode: 0o600 });
    return report;
  }
  cancel() { this.job?.controller.abort(); }
  async chat(body,{signal,onChunk}={}) {
    if(!body||typeof body!=='object'||Array.isArray(body)||!Array.isArray(body.messages)||body.messages.some(m=>!m||typeof m!=='object'||Array.isArray(m))||(body.tools!==undefined&&!Array.isArray(body.tools)))throw new Error('invalid_chat_request');
    if(this.pending&&!this.pending.used)throw new Error('login in progress');
    this.gatewayActive++;
    const startedAt=new Date().toISOString();
    const trace={startedAt,model:typeof body.model==='string'?body.model.slice(0,256):null,fields:Object.keys(body),stream:body.stream===true,messageCount:body.messages?.length,roles:body.messages?.map(m=>m.role),messageFields:body.messages?.map(m=>Object.keys(m)),reasoningEffort:typeof body.reasoning_effort==='string'?body.reasoning_effort.slice(0,32):undefined,toolCount:body.tools?.length||0,toolResults:body.messages?.filter(m=>m.role==='tool').length||0};
    try{
      if(!this.models.length)await this.refreshCatalog();
      const scope=this.vault.active;
      const token=await this.accessToken();
      const bounded=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(180_000)]);
      const adapter=new ChatAdapter({catalog:this.models,scope,states:this.toolStates,
        persist:async()=>{
          const snapshot=structuredClone([...this.toolStates]);
          this.stateWrite=this.stateWrite.catch(()=>{}).then(()=>saveVault(join(this.dataDir,'tool-states.dpapi'),snapshot));
          await this.stateWrite;
        },
        request:async(request,{onEvent})=>readResponseStream(await this.fetcher(`${RESOURCE}/responses`,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify(request),signal:bounded}),{signal:bounded,onEvent}),
      });
      const result=await adapter.complete(body,{signal:bounded,onChunk});
      trace.status='completed';trace.finishReason=result.choices[0].finish_reason;
      trace.returnedToolNames=result.choices[0].message.tool_calls?.map(t=>t.function.name)||[];
      return result;
    }catch(error){trace.status='failed';trace.error=safeError(error);throw error;}
    finally{this.gatewayActive--;trace.finishedAt=new Date().toISOString();await appendFile(join(this.dataDir,'gateway-trace.jsonl'),JSON.stringify(trace)+'\n',{mode:0o600});}
  }
}
