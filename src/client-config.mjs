import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildWorkBuddyModel } from "./workbuddy-config.mjs";
import { saveVault } from "./vault.mjs";

export function mergeWorkBuddyModels(
  existing,
  models,
  { url, key, engineUrl, archiveUnavailable = false },
) {
  if (!Array.isArray(existing)) throw new Error("WorkBuddy 配置格式无法识别");
  const selected = models.filter(
    (m) => m.selectable && m.checks?.tools?.status === "passed",
  );
  if (!selected.length) throw new Error("请先完成至少一个模型的工具验证");
  const allowed = [
    url,
    url.includes("/workbuddy/")
      ? url.replace("/workbuddy/v1/", "/v1/")
      : url.replace("/v1/", "/workbuddy/v1/"),
    engineUrl + "/v1/chat/completions",
  ];
  // Only retire our own generated entries on this gateway. The complete prior
  // file is encrypted and backed up before any change is written below.
  const result = existing.filter(
    (x) =>
      !(
        archiveUnavailable &&
        /^ModelBridge · /.test(x.name || "") &&
        allowed.slice(0, 2).includes(x.url) &&
        !models.some((m) => m.slug === x.id && m.selectable)
      ),
  );
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
      ...(old || buildWorkBuddyModel(m, { url, key })),
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
      url: base + (service.direct ? "/workbuddy" : "") + "/v1/chat/completions",
      key,
      engineUrl: service.config?.baseUrl,
      archiveUnavailable: true,
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
    archived: JSON.parse(original)
      .filter((x) => !result.some((r) => r.id === x.id))
      .map((x) => x.id),
    configured: result
      .filter(
        (x) =>
          x.url ===
          base + (service.direct ? "/workbuddy" : "") + "/v1/chat/completions",
      )
      .map((x) => x.id),
    message: "已保存加密备份并更新配置；在 WorkBuddy 刷新窗口后生效。",
  };
}
