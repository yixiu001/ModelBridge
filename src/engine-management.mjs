import { buildCodexQuotaWindows } from "./vendor/codex-quota.ts";
import { engineError } from "./engine-client.mjs";

const labels = {
  primary_window: "5 小时窗口",
  secondary_window: "每周窗口",
  team_secondary_window: "每月窗口",
  code_review_primary_window: "代码审查 · 5 小时",
  code_review_secondary_window: "代码审查 · 每周",
  code_review_team_secondary_window: "代码审查 · 每月",
  additional_primary_window: "附加 · 短周期",
  additional_secondary_window: "附加 · 每周",
  additional_team_secondary_window: "附加 · 每月",
};
function account(service, key) {
  const a = service.privateAccounts?.get(key);
  if (!a) throw engineError("账号不存在，请刷新列表", "unknown_account", 404);
  return a;
}
function accountId(a) {
  let token = a.id_token;
  try {
    if (typeof token === "string")
      token = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
  } catch {
    token = null;
  }
  return (
    token?.["https://api.openai.com/auth"]?.chatgpt_account_id ||
    token?.chatgpt_account_id
  );
}
export const managementMethods = {
  async accountAction(key, action) {
    if (
      this.job ||
      this.gatewayActive ||
      this.pending ||
      this.connecting ||
      this.mutating
    )
      throw engineError("请等待当前调用或授权结束", "busy", 409);
    const a = account(this, key);
    if (!["enable", "disable", "remove"].includes(action))
      throw engineError("账号操作无效", "invalid_action", 400);
    this.mutating = true;
    try {
      if (action === "remove")
        await this.json(
          "/v0/management/auth-files?name=" + encodeURIComponent(a.name),
          { management: true, method: "DELETE" },
        );
      else
        await this.json("/v0/management/auth-files/status", {
          management: true,
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: a.name,
            disabled: action === "disable",
          }),
        });
      await this.refreshCatalog();
      return { ok: true };
    } finally {
      this.mutating = false;
    }
  },
  async quota(key) {
    const a = account(this, key),
      context = this.context;
    const header = {
      Authorization: "Bearer $TOKEN$",
      "Content-Type": "application/json",
      "User-Agent": "codex-tui/0.149.1",
    };
    const id = accountId(a);
    if (id) header["Chatgpt-Account-Id"] = id;
    try {
      const r = await this.json("/v0/management/api-call", {
        management: true,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auth_index: a.auth_index,
          method: "GET",
          url: "https://chatgpt.com/backend-api/wham/usage",
          header,
        }),
      });
      if (
        r.status_code < 200 ||
        r.status_code >= 300 ||
        !Number.isFinite(r.status_code)
      )
        throw engineError(
          "额度查询未成功（HTTP " + r.status_code + "），稍后重试",
          "quota_unavailable",
          502,
        );
      let payload = typeof r.body === "string" ? JSON.parse(r.body) : r.body;
      if (!payload || typeof payload !== "object")
        throw engineError("额度响应无法识别", "quota_unavailable", 502);
      const windows = buildCodexQuotaWindows(payload, (key, p) =>
        [p?.name, labels[key.replace("codex_quota.", "")] || "用量窗口"]
          .filter(Boolean)
          .join(" · "),
      );
      const plan = payload.plan_type ?? payload.planType;
      const result = {
        status: windows.length ? "available" : "unavailable",
        planType: typeof plan === "string" ? plan.slice(0, 80) : null,
        windows,
        checkedAt: new Date().toISOString(),
      };
      if (this.context === context) this.quotas.set(key, result);
      return result;
    } catch (e) {
      const result = {
        status: "unavailable",
        windows: [],
        message: e.details ? e.message : "额度暂时无法查询，请稍后重试",
        checkedAt: new Date().toISOString(),
      };
      if (this.context === context) this.quotas.set(key, result);
      return result;
    }
  },
  async settings() {
    const [retry, routing, logging] = await Promise.all(
      ["/request-retry", "/routing/strategy", "/logging-to-file"].map((p) =>
        this.json("/v0/management" + p, { management: true }),
      ),
    );
    return {
      requestRetry: retry["request-retry"],
      routingStrategy: routing.strategy,
      loggingToFile: logging["logging-to-file"],
      timeoutSeconds: this.timeoutSeconds || 180,
    };
  },
  async updateSettings(data) {
    if (
      this.job ||
      this.gatewayActive ||
      this.pending ||
      this.mutating ||
      this.connecting
    )
      throw engineError("请等待当前操作结束", "busy", 409);
    if (
      !Number.isInteger(data.requestRetry) ||
      data.requestRetry < 0 ||
      data.requestRetry > 3 ||
      !["round-robin", "fill-first"].includes(data.routingStrategy) ||
      typeof data.loggingToFile !== "boolean" ||
      !Number.isInteger(data.timeoutSeconds) ||
      data.timeoutSeconds < 30 ||
      data.timeoutSeconds > 600
    )
      throw engineError("设置值不在允许范围内", "invalid_settings", 400);
    this.mutating = true;
    try {
      for (const [path, value] of [
        ["/request-retry", data.requestRetry],
        ["/routing/strategy", data.routingStrategy],
        ["/logging-to-file", data.loggingToFile],
      ])
        await this.json("/v0/management" + path, {
          management: true,
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value }),
        });
      this.timeoutSeconds = data.timeoutSeconds;
      await this.savePreferences();
      return await this.settings();
    } finally {
      this.mutating = false;
    }
  },
};
