import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { saveVault } from "./vault.mjs";

export function mergeWorkBuddyModels(
  existing,
  models,
  { url, key, engineUrl },
) {
  if (!Array.isArray(existing)) throw new Error("WorkBuddy 配置格式无法识别");
  const selected = models.filter(
    (m) => m.selectable && m.checks?.tools?.status === "passed",
  );
  if (!selected.length) throw new Error("请先完成至少一个模型的工具验证");
  const allowed = [
    url,
    url.replace("/v1/", "/workbuddy/v1/"),
    engineUrl + "/v1/chat/completions",
  ];
  const result = [...existing];
  for (const m of selected) {
    const index = result.findIndex((x) => x.id === m.slug),
      old = result[index];
    if (
      old &&
      (!/^(ModelBridge|CLIProxyAPI) · /.test(old.name || "") ||
        !allowed.includes(old.url))
    )
      throw new Error("存在同名的其他模型配置，未修改 WorkBuddy");
    const item = {
      ...(old || {
        vendor: "custom",
        supportsToolCall: true,
        supportsImages: false,
        supportsReasoning: false,
        useCustomProtocol: true,
      }),
      id: m.slug,
      name: "ModelBridge · " + m.displayName,
      url,
      apiKey: key,
    };
    if (index < 0) result.push(item);
    else result[index] = item;
  }
  return result;
}
export async function configureWorkBuddy({ service, base, key }) {
  const target = resolve(process.env.USERPROFILE, ".workbuddy", "models.json");
  const original = await readFile(target, "utf8");
  const result = mergeWorkBuddyModels(
    JSON.parse(original),
    service.status().models,
    {
      url: base + "/v1/chat/completions",
      key,
      engineUrl: service.config.baseUrl,
    },
  );
  await saveVault(
    join(service.dataDir, "workbuddy-backup-" + Date.now() + ".dpapi"),
    { path: target, content: original },
  );
  if ((await readFile(target, "utf8")) !== original)
    throw new Error("WorkBuddy 配置已变化，请重试");
  const temporary = target + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(result, null, 2), { flag: "wx" });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  return {
    configured: result
      .filter((x) => x.url === base + "/v1/chat/completions")
      .map((x) => x.id),
    message: "已保存加密备份并更新配置；在 WorkBuddy 刷新窗口后生效。",
  };
}
