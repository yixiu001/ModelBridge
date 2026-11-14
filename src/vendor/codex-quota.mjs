// Selectively adapted from CLI Proxy API Management Center (MIT).
// Copyright (c) 2026 Router-For.ME. Source: 3d893ec88938c3ceef200a15be6af8cf972564b3,
// src/features/quota/providers/codex/data.ts; see THIRD_PARTY_NOTICES.md.
// Keeps duration-based window classification; omits UI, redemption and other providers.
const record = (v) => v && typeof v === "object" && !Array.isArray(v);
// Selective port of parseCodexSubscriptionActiveUntil from the same upstream
// data.ts revision. Normalize valid instants; never infer from token expiration.
export function parseCodexSubscription(payload) {
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return null; }
  }
  if (!record(payload)) return null;
  const value = payload.active_until ?? payload.activeUntil;
  let ms;
  if (typeof value === 'number' || typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    const n = Number(value);
    ms = n > 0 && Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : NaN;
  } else if (typeof value === 'string') {
    const text=value.trim();
    const parts=/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(text);
    if (!parts) return null;
    const [,year,month,day]=parts.map(Number);
    if (month<1 || month>12 || day<1 || day>new Date(Date.UTC(year,month,0)).getUTCDate()) return null;
    ms=Date.parse(text);
  }
  return Number.isFinite(ms) && ms>0 && ms<=8640000000000000 ? new Date(ms).toISOString() : null;
}
const number = (v) =>
  (typeof v === "number" || (typeof v === "string" && v.trim())) &&
  Number.isFinite(Number(v))
    ? Number(v)
    : null;
const seconds = (w) => number(w?.limit_window_seconds ?? w?.limitWindowSeconds);
const monthly = (w) => seconds(w) >= 28 * 86400 && seconds(w) <= 31 * 86400;
function classify(info) {
  const primary = info?.primary_window ?? info?.primaryWindow;
  const secondary = info?.secondary_window ?? info?.secondaryWindow;
  const raw = [primary, secondary].filter(record);
  let short = raw.find((w) => seconds(w) === 18000),
    long = raw.find((w) => seconds(w) === 604800 || monthly(w));
  short ??= record(primary) && primary !== long ? primary : null;
  long ??= record(secondary) && secondary !== short ? secondary : null;
  return [short, long];
}
function reset(w, now) {
  for (const v of [w.reset_at, w.resetAt]) {
    const n = number(v);
    const ms =
      n !== null && n > 0
        ? n < 1e12
          ? n * 1000
          : n
        : typeof v === "string" && !/^\s*\d+\s*$/.test(v)
          ? Date.parse(v)
          : NaN;
    if (Number.isFinite(ms) && ms > 0 && ms <= 8640000000000000) return ms;
  }
  const offset = number(w.reset_after_seconds ?? w.resetAfterSeconds);
  const ms = offset !== null && offset >= 0 ? now + offset * 1000 : null;
  return ms !== null && ms <= 8640000000000000 ? ms : null;
}
export function parseCodexQuota(payload, now = Date.now()) {
  if (!record(payload)) throw new Error("invalid quota payload");
  const windows = [];
  function add(info, prefix = "", name = "") {
    for (const [index, w] of classify(info).entries()) {
      if (!w) continue;
      const duration=seconds(w);
      const kind = duration===18000?'five-hour':duration===604800?'weekly':monthly(w)?'monthly':duration>0?`hours-${duration/3600}`:`unknown-${index}`;
      const raw = number(w.used_percent ?? w.usedPercent);
      const usedPercent = raw !== null && raw >= 0 && raw <= 100 ? raw : null;
      windows.push({
        id: prefix + kind,
        label:
          name +
          ({ "five-hour": "5 小时", weekly: "每周", monthly: "每月" }[kind] || (duration>0?`${duration/3600} 小时`:"未知周期")),
        usedPercent,
        resetAtMs: reset(w, now),
        periodHours: seconds(w) > 0 ? seconds(w) / 3600 : null,
      });
    }
  }
  add(payload.rate_limit ?? payload.rateLimit);
  add(
    payload.code_review_rate_limit ?? payload.codeReviewRateLimit,
    "code-review-",
    "代码审查 · ",
  );
  const extra = payload.additional_rate_limits ?? payload.additionalRateLimits;
  if (Array.isArray(extra))
    extra.slice(0, 32).forEach((v, i) => {
      if (!record(v)) return;
      const raw =
        v.limit_name ?? v.limitName ?? v.metered_feature ?? v.meteredFeature;
      const name =
        typeof raw === "string"
          ? raw.slice(0, 120).replace(/[\x00-\x1f]/g, "")
          : `附加额度 ${i + 1}`;
      add(v.rate_limit ?? v.rateLimit, `additional-${i}-`, name + " · ");
    });
  const hasKnownCredit=payload.credits?.unlimited===true || /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(payload.credits?.balance));
  if (!windows.some(w=>w.usedPercent!==null||w.resetAtMs!==null||w.periodHours!==null) && !hasKnownCredit)
    throw new Error("quota windows unavailable");
  const plan = payload.plan_type ?? payload.planType;
  const balance = payload.credits?.balance;
  return {
    planType:
      typeof plan === "string" && /^[a-zA-Z0-9_-]{1,60}$/.test(plan)
        ? plan
        : null,
    windows,
    creditBalance:
      typeof balance === "string" || typeof balance === "number"
        ? /^\d+(\.\d+)?$/.test(String(balance)) &&
          Number.isFinite(Number(balance))
          ? String(balance)
          : null
        : null,
    creditsUnlimited: payload.credits?.unlimited === true,
  };
}
