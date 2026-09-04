/** Best-effort open of a URL in the platform default browser (never throws). */
export const openInBrowser = (url: string): void => {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn({ cmd, stdout: "ignore", stderr: "ignore" });
  } catch {
    // A browser not being available (headless/CI) must not fail the login —
    // the status dialog still shows the URL / device code.
  }
};