import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
test("completed probes exit even while their parent IPC channel stays open", async () => {
  const module = new URL("../src/parent-lifecycle.mjs", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {watchParent} from ${JSON.stringify(module)};watchParent();console.log('done');`,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  try {
    const code = await Promise.race([
      new Promise((resolve, reject) => {
        child.once("exit", resolve);
        child.once("error", reject);
      }),
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("completed probe is stuck")),
          2000,
        );
        timer.unref();
      }),
    ]);
    assert.equal(code, 0);
  } finally {
    child.kill();
  }
});
test("probe subprocess exits when its owning server disconnects, including forced Windows shutdown", async () => {
  const module = new URL("../src/parent-lifecycle.mjs", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {watchParent} from ${JSON.stringify(module)};watchParent();console.log('ready');setInterval(()=>{},1000);`,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once("data", (b) =>
        b.toString().includes("ready")
          ? resolve()
          : reject(new Error("not ready")),
      );
      child.once("error", reject);
      child.once("exit", () => reject(new Error("exited before ready")));
    });
    const ended = new Promise((r) => child.once("exit", r));
    child.disconnect();
    const code = await Promise.race([
      ended,
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("probe survived parent")),
          2000,
        );
        timer.unref();
      }),
    ]);
    assert.equal(code, 143);
  } finally {
    child.kill();
  }
});
