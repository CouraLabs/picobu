import puppeteer, { type Browser } from "puppeteer";

/**
 * Chrome identity used for both the User-Agent and the matching client-hint
 * headers: a real Chrome 124 desktop profile (headless Chrome would otherwise
 * report "HeadlessChrome", which bot protections block on sight).
 */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** HTTP headers sent with every navigation, mirroring a real Chrome request.
 * Note: `Sec-Fetch-*` headers are intentionally NOT overridden — Chrome
 * computes them per request, and forcing them (e.g. `dest: document` on
 * sub-frame loads) is itself a bot fingerprint that detectors flag. */
const BROWSER_HEADERS: Record<string, string> = {
  "user-agent": USER_AGENT,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  dnt: "1",
  "upgrade-insecure-requests": "1",
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
};

/**
 * Headless-Chrome launch args: `--disable-blink-features=AutomationControlled`
 * keeps `navigator.webdriver` from being set, the other two reduce the most
 * obvious headless fingerprints. `--no-sandbox` is required in some CI/root
 * environments and is safe here (only trusted pages are visited).
 */
const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-infobars",
  "--disable-dev-shm-usage",
];

/**
 * Page patch applied before any script runs: makes the automation surfaces
 * match real Chrome — `navigator.webdriver` is `false` and lives on the
 * `Navigator` prototype (an own instance property would be flagged by
 * `_.has(navigator, "webdriver")`-style checks), and `window.chrome` exposes
 * the full runtime surface (`app`, `runtime`, `csi`, `loadTimes`) that bot
 * detectors probe for. Only missing pieces are filled in so the native
 * surface keeps its own identity.
 */
const ANTI_DETECTION_SCRIPT = `
  const navigatorProto = Object.getPrototypeOf(navigator);
  Object.defineProperty(navigatorProto, "webdriver", { get: () => false, set: undefined, configurable: true, enumerable: true });
  const chromeRuntime = {
    OnInstalledReason: { CHROME_UPDATE: "chrome_update", INSTALL: "install", SHARED_MODULE_UPDATE: "shared_module_update", UPDATE: "update" },
    OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" },
    PlatformArch: { ARM: "arm", ARM64: "arm64", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
    PlatformNaclArch: { ARM: "arm", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
    PlatformOs: { ANDROID: "android", CROS: "cros", LINUX: "linux", MAC: "mac", OPENBSD: "openbsd", WIN: "win" },
    RequestUpdateCheckStatus: { NO_UPDATE: "no_update", THROTTLED: "throttled", UPDATE_AVAILABLE: "update_available" },
    connect: () => {},
    sendMessage: () => {},
  };
  const chromeApp = {
    isInstalled: false,
    InstallState: { INSTALLED: "installed", NOT_INSTALLED: "not_installed", DISABLED: "disabled" },
    RunningState: { RUNNING: "running", CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run" },
    getDetails: () => undefined,
    getIsInstalled: () => false,
    installState: () => "disabled",
  };
  if (!window.chrome) {
    window.chrome = { app: chromeApp, runtime: chromeRuntime, csi: () => ({}), loadTimes: () => ({}) };
  } else {
    if (!window.chrome.runtime) window.chrome.runtime = chromeRuntime;
    if (!window.chrome.app) window.chrome.app = chromeApp;
    if (typeof window.chrome.csi !== "function") window.chrome.csi = () => ({});
    if (typeof window.chrome.loadTimes !== "function") window.chrome.loadTimes = () => ({});
  }
`;

/** Shared headless Chrome instance: launched lazily on first render and reused
 * for every web tool call afterwards (launching Chrome per call is too slow).
 * Closed best-effort when the process exits or is signaled.
 */
let browser: Browser | null = null;

/** In-flight launch, so parallel first calls share one Chrome instead of each
 * racing `puppeteer.launch()` (every loser would leak a full Chrome process
 * tree — the module-level `browser` only keeps the last winner). */
let launching: Promise<Browser> | null = null;

/** Close the shared browser (idempotent). The singleton is dropped first so a
 * later `getBrowser()` relaunches instead of returning a corpse. */
function closeBrowser(): void {
  const instance = browser;
  browser = null;
  launching = null;
  if (instance) void instance.close().catch(() => {});
}

async function launchBrowser(): Promise<Browser> {
  const instance = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
  browser = instance;
  // `exit` fires on process.exit() and natural exit (TUI quit path), but NOT
  // on default-disposition signals (web server Ctrl+C, kills) — so the common
  // termination signals get their own handler. In the TUI, OpenTUI registers
  // its own SIGINT listener first (renderer teardown -> process.exit), so this
  // handler only matters when nothing else handles the signal.
  process.once("exit", closeBrowser);
  // Conventional signal -> exit codes (128 + signal number).
  const SIGNAL_CODES: Record<string, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      closeBrowser();
      // Re-raise the default disposition: terminate with the conventional
      // 128+signal exit code so external supervisors see the same outcome.
      process.exit(SIGNAL_CODES[signal]);
    });
  }
  return instance;
}

async function getBrowser(): Promise<Browser> {
  if (browser?.connected) return browser;
  if (!launching) {
    launching = launchBrowser().finally(() => {
      launching = null;
    });
  }
  return launching;
}

/**
 * Page concurrency cap: every render opens a tab in the shared Chrome, and
 * parallel tool calls (two websearches + a few webfetches) can otherwise load
 * a dozen heavy pages at once, starving the machine and stalling every
 * navigation. The limiter keeps at most `PAGE_LIMIT` pages in flight; callers
 * queue for a slot.
 */
const PAGE_LIMIT = 4;
let pagesOpen = 0;
const waiters: (() => void)[] = [];

async function acquirePageSlot(): Promise<void> {
  if (pagesOpen < PAGE_LIMIT) {
    pagesOpen++;
    return;
  }
  // Slot is handed over directly by `releasePageSlot` (the open-page count is
  // not decremented on transfer), so the cap can never be exceeded.
  await new Promise<void>((resolve) => waiters.push(resolve));
}

function releasePageSlot(): void {
  const wake = waiters.shift();
  if (wake) {
    wake(); // transfer the slot to the queued caller; count stays the same
    return;
  }
  pagesOpen--;
}

export type RenderedPage = {
  /** Final URL after redirects. */
  url: string;
  /** Content-Type of the response (before the `;` parameters). */
  contentType: string;
  /** HTTP status code of the response. */
  status: number;
  /** Response body: the rendered DOM for HTML pages, raw text otherwise. */
  body: string;
};

/**
 * Fetch a URL with headless Chrome disguised as a regular Chrome browser (UA,
 * client hints, `Sec-Fetch-*` headers, and `navigator.webdriver` scrubbed) so
 * JavaScript executes and bot protections don't block the request. Returns the
 * final URL, response content type, and the rendered DOM (HTML pages) or raw
 * body (any other content type).
 */
export async function renderPage(
  url: string,
  { timeout = 30_000 }: { timeout?: number } = {},
): Promise<RenderedPage> {
  const instance = await getBrowser();
  await acquirePageSlot();
  let page: Awaited<ReturnType<Browser["newPage"]>>;
  try {
    page = await instance.newPage();
  } catch (error) {
    releasePageSlot();
    throw error;
  }
  try {
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders(BROWSER_HEADERS);
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false });
    await page.evaluateOnNewDocument(ANTI_DETECTION_SCRIPT);
    const response = await page.goto(url, { waitUntil: "networkidle2", timeout });
    if (!response) throw new Error(`No response from ${url}`);

    const contentType = response.headers()["content-type"]?.split(";")[0]?.trim() ?? "";
    const isHtml = contentType === "text/html" || contentType === "application/xhtml+xml";
    const body = isHtml ? await page.content() : await response.text();
    return { url: page.url(), contentType, status: response.status(), body };
  } finally {
    await page.close();
    releasePageSlot();
  }
}
