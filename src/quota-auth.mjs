// OAuth parameters selectively adapted from CLIProxyAPI v8.0.69
// internal/auth/codex/openai_auth.go (MIT); see THIRD_PARTY_NOTICES.md.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
export const CODEX_CLIENT = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_TOKEN = "https://auth.openai.com/oauth/token";
export function beginQuotaLogin(key) {
  const state = randomBytes(32).toString("base64url"),
    nonce = randomBytes(32).toString("base64url"),
    verifier = randomBytes(48).toString("base64url");
  const redirectUri = "http://localhost:1455/auth/callback";
  const url = new URL("https://auth.openai.com/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: CODEX_CLIENT,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid email profile offline_access",
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
  }).toString();
  return {
    url: url.href,
    state,
    nonce,
    verifier,
    redirectUri,
    account: { client_id: CODEX_CLIENT },
    quotaAccountKey: key,
    purpose: "quota",
    expiresAt: Date.now() + 600000,
    used: false,
  };
}
export async function listenQuotaCallback(finish, returnBase, port = 1455) {
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    const boundPort = server.address()?.port;
    if (
      ![`localhost:${boundPort}`, `127.0.0.1:${boundPort}`].includes(
        req.headers.host,
      ) ||
      req.method !== "GET" ||
      !req.url.startsWith("/") ||
      req.url.startsWith("//")
    ) {
      res.writeHead(400);
      res.end("回调请求无效");
      return;
    }
    try {
      const url = new URL(req.url, "http://localhost:1455");
      if (url.pathname !== "/auth/callback" || url.host !== "localhost:1455") {
        res.writeHead(404);
        res.end();
        return;
      }
      await finish(url.searchParams);
      res.writeHead(303, { Location: returnBase + "/#quota" });
      res.end();
    } catch {
      res.writeHead(400);
      res.end("配额授权未完成，请返回 ModelBridge 查看提示并重新授权。");
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  server.unref();
  return server;
}
