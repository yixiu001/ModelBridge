import { readFile, writeFile } from "node:fs/promises";
import { localFetch } from "../src/engine-client.mjs";
const local = new URL("../.local/", import.meta.url),
  control = JSON.parse(await readFile(new URL("control.json", local), "utf8"));
async function call(path, data) {
  const r = await localFetch(control.base + "/api/" + path, {
    method: data ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + control.key,
      "content-type": "application/json",
    },
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(16 * 60 * 1000),
  });
  if (!r.ok) throw new Error("Local API HTTP " + r.status);
  return r.json();
}
const state = await call("status");
const models = state.models
  .filter((m) => m.selectable)
  .map((m) => m.slug)
  .sort();
const report = {
  startedAt: new Date().toISOString(),
  engineVersion: state.engine.version,
  results: [],
};
const path = new URL("engine-acceptance.json", local);
for (const model of models) {
  for (const kind of ["tools", "files", "mcp"]) {
    const result = await call("verify", { model, kind });
    report.results.push(result);
    await writeFile(path, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(result));
  }
}
const long = await call("verify", {
  model: models.includes("gpt-6.1-sol") ? "gpt-6.1-sol" : models[0],
  kind: "long",
});
report.results.push(long);
report.finishedAt = new Date().toISOString();
report.status = report.results.every((r) => r.status === "passed")
  ? "passed"
  : "failed";
await writeFile(path, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    status: report.status,
    checks: report.results.length,
    long,
  }),
);
if (report.status !== "passed") process.exitCode = 1;
