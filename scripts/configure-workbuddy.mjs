import { readFile } from "node:fs/promises";
import { localFetch } from "../src/local-client.mjs";
if (process.argv.length > 2)
  throw new Error(
    "Use node scripts/configure-workbuddy.mjs; the current service configures the dedicated WorkBuddy compatibility endpoint",
  );
const c = JSON.parse(
  await readFile(new URL("../.local/control.json", import.meta.url), "utf8"),
);
const r = await localFetch(c.base + "/api/workbuddy/configure", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + c.key,
    "content-type": "application/json",
  },
  body: "{}",
});
const result = await r.json();
if (!r.ok)
  throw new Error(
    result.error?.message || result.error || "Configuration failed",
  );
console.log(JSON.stringify(result));
