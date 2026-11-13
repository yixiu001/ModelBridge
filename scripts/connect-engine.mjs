import { readFile } from "node:fs/promises";
import { localFetch } from "../src/engine-client.mjs";
// Explicit opt-in to an existing CLIProxyAPI installation's local access keys.
// This does not read account OAuth files or other applications' credentials.
const [accessFile, baseUrl = "http://127.0.0.1:8317"] = process.argv.slice(2);
if (!accessFile)
  throw new Error(
    "Usage: node scripts/connect-engine.mjs <CLIProxyAPI access.json> [loopback URL]",
  );
const keys = JSON.parse(await readFile(accessFile, "utf8"));
const control = JSON.parse(
  await readFile(new URL("../.local/control.json", import.meta.url), "utf8"),
);
const r = await localFetch(control.base + "/api/engine/connect", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + control.key,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    baseUrl,
    apiKey: keys.clientKey,
    managementKey: keys.managementKey,
  }),
});
const value = await r.json();
if (!r.ok) throw new Error(value.error?.message || "Engine connection failed");
console.log(
  JSON.stringify({
    connected: value.engine.reachable,
    version: value.engine.version,
    accounts: value.accounts.length,
    models: value.models.length,
  }),
);
