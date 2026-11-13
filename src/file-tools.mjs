import { readFile, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
export async function executeFileTool(dir, name, args) {
  if (
    name === "read_file" &&
    ["input.json", "result.json"].includes(args.path)
  ) {
    const path = join(dir, args.path);
    if (!(await lstat(path)).isFile()) throw new Error("not_a_regular_file");
    return readFile(path, "utf8");
  }
  if (
    name === "write_file" &&
    args.path === "result.json" &&
    typeof args.content === "string" &&
    args.content.length < 4096
  ) {
    await writeFile(join(dir, "result.json"), args.content, { flag: "wx" });
    return "saved";
  }
  throw new Error("file_tool_outside_fixture");
}
