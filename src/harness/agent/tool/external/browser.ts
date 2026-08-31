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
 * Closed best-effort when the process exits.
 */
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
    process.once("exit", () => {
      void browser?.close();
    });
  }
  return browser;
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
  const page = await instance.newPage();
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
  }
}
