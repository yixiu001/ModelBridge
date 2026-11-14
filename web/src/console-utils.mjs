export const date = (value) =>
  value
    ? new Date(
        typeof value === "number" && value < 1e12 ? value * 1000 : value,
      ).toLocaleString("zh-CN", { hour12: false })
    : "—";
export const count = (value) =>
  Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";
export function subscriptionSummary(quota) {
  const s=quota?.subscription;
  let message='尚未查询';
  if(s?.status==='available')message=quota.freshness!=='current'?'历史快照，请刷新确认':Date.parse(s.activeUntil)<=Date.now()?'官方返回时间已到达，不据此判断调用权限失效':'官方订阅有效期';
  else if(s?.status==='unavailable')message=s.reason==='missing_account_id'?'账号缺少订阅查询标识':s.reason==='not_returned'?'官方未返回订阅到期时间':'本次未查询订阅';
  else if(s?.status==='error')message=s.reason==='timeout'?'订阅查询超时，可刷新重试':s.httpStatus?`订阅查询失败（HTTP ${s.httpStatus}）`:s.reason==='cancelled'?'订阅查询已取消':'订阅查询失败，可刷新重试';
  return {activeUntil:s?.status==='available'?s.activeUntil:null,checkedAt:s?.checkedAt,previous:s?.previous,message};
}
export const accountState = (a) =>
  a.disabled
    ? "disabled"
    : a.health && (a.health.inference.state!=="ready" || ["refresh_failed","sign_in_required","expired"].includes(a.health.quota.state))
      ? "problem"
      : a.status === "active" && !a.unavailable
      ? "active"
      : "problem";
export const remaining = (a) => {
  const windows = a.quota?.status === "available" ? a.quota.windows : [];
  const values = windows
    .filter((w) => Number.isFinite(w.usedPercent))
    .map((w) => Math.max(0, 100 - w.usedPercent));
  return values.length ? Math.min(...values) : null;
};
export function trafficSummary(traffic) {
  const rows = traffic.filter((r) => r.model);
  const success = rows.filter((r) => r.status === "forwarded").length;
  const cancelled = rows.filter((r) => r.status === "cancelled").length;
  const failed = rows.length - success - cancelled;
  const models = Object.values(
    rows.reduce((all, r) => {
      const item = (all[r.model] ??= {
        model: r.model,
        total: 0,
        success: 0,
        failed: 0,
        cancelled: 0,
      });
      item.total++;
      item[
        r.status === "forwarded"
          ? "success"
          : r.status === "cancelled"
            ? "cancelled"
            : "failed"
      ]++;
      return all;
    }, Object.create(null)),
  ).sort((a, b) => b.total - a.total);
  return {
    total: rows.length,
    success,
    failed,
    cancelled,
    successRate: success + failed ? (100 * success) / (success + failed) : null,
    models,
  };
}
export function download(name, data) {
  const url = URL.createObjectURL(
    new Blob(
      [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
      { type: "application/json;charset=utf-8" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
