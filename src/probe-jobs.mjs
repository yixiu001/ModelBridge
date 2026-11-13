import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clientError } from "./local-client.mjs";
export async function runProbe(model, kind) {
  if (this.job || this.connecting || this.mutating || this.pending)
    throw clientError("已有操作正在运行", "busy", 409);
  if (
    !this.reachable ||
    !this.models.some((m) => m.slug === model && m.selectable) ||
    !["files", "mcp", "long"].includes(kind)
  )
    throw clientError("请选择可用的文本模型与验证类型", "invalid_test", 400);
  const controller = new AbortController(),
    context = this.context;
  const report = {
    model,
    kind,
    engine: "ModelBridge",
    context,verificationKey:this.reportKey?.(model,kind),
    status: "failed",
    startedAt: new Date().toISOString(),
  };
  this.job = { model, kind, controller };
  const script = kind === "files" ? "file-probe.mjs" : "mcp-probe.mjs";
  const options =
    kind === "files"
      ? []
      : kind === "long"
        ? ["--turns=12", "--padding=65536"]
        : ["--turns=2"];
  let last;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("../scripts/" + script, import.meta.url)),
          model,
          ...options,
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] },
      );
      let buffer = "";
      const timer = setTimeout(() => controller.abort(), 15 * 60 * 1000);
      const abort = () => child.kill();
      controller.signal.addEventListener("abort", abort, { once: true });
      child.stderr.resume();
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.length > 65536) {
          child.kill();
          return;
        }
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const item = JSON.parse(line);
            if (item.status === "progress" && this.job)
              this.job.progress = item.turn;
            else last = item;
          } catch {}
        }
      });
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", abort);
        if (code === 0 && last?.status === "passed") resolve();
        else reject(clientError("验证未完成，请查看结果", "probe_failed"));
      });
    });
    Object.assign(report, {
      status: "passed",
      requests: last.requests,
      toolCalls: last.toolCalls ?? last.mcpCalls,
      maxRequestBytes: last.maxRequestBytes,
      maxMessages: last.maxMessages,
    });
  } catch (e) {
    report.status = controller.signal.aborted
      ? "cancelled_or_timeout"
      : "failed";
    report.error = {
      message: controller.signal.aborted
        ? "验证已取消或超时"
        : "验证失败：" +
          String(last?.error || e.details?.code || "probe_failed").slice(
            0,
            250,
          ),
      code: "probe_failed",
    };
  } finally {
    report.finishedAt = new Date().toISOString();
    try {
      if(this.saveReport) await this.saveReport(report);
      else if(this.context===context) {this.reports.push(report);await writeFile(join(this.dataDir,this.reportFile||'direct-reports.json'),JSON.stringify({context,reports:this.reports}));}
    } finally {
      this.job = null;
    }
  }
  return report;
}
