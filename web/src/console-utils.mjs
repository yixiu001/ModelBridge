export const date = (value) =>
  value
    ? new Date(
        typeof value === "number" && value < 1e12 ? value * 1000 : value,
      ).toLocaleString("zh-CN", { hour12: false })
    : "—";
export const count = (value) =>
  Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";
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
