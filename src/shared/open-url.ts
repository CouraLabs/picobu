import { spawn } from "node:child_process";

export const openInBrowser = (url: string): void => {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    const proc = Bun.spawn({ cmd, stdout: "ignore", stderr: "ignore" });
    proc.unref();
    return;
  } catch {
  }
  try {
    const child = spawn(cmd[0] as string, cmd.slice(1), { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
  }
};
