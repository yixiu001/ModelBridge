export function summarizeUpstreamError(text, secrets = []) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const error = value?.error;
  if (!error) return null;
  let message =
    typeof error === "string"
      ? error
      : typeof error.message === "string"
        ? error.message
        : "";
  for (const secret of secrets.filter(Boolean))
    message = message.split(secret).join("[已隐藏]");
  message = message
    .replace(/Bearer\s+[^\s;,]+/gi, "Bearer [已隐藏]")
    .replace(/\beyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?/g, "[令牌已隐藏]")
    .replace(/\b(?:sk-|mb_)[\w-]+/g, "[密钥已隐藏]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[邮箱已隐藏]")
    .replace(/\s+/g, " ")
    .slice(0, 400);
  const code =
    typeof error.code === "string" && /^[\w.-]{1,80}$/.test(error.code)
      ? error.code
      : "upstream_error";
  return { code, message: message || "上游报告请求失败" };
}
