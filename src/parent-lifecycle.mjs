// IPC closes even when Windows force-terminates the owning server.
// Command-line probes without an IPC parent keep their normal lifecycle.
export function watchParent() {
  if (typeof process.send !== "function") return;
  if (!process.connected) {
    process.exit(143);
    return;
  }
  process.once("disconnect", () => process.exit(143));
  // Listen while a probe is busy without keeping a completed probe alive.
  process.channel?.unref();
}
