import puppeteer, { type Browser } from 'puppeteer'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const BROWSER_HEADERS: Record<string, string> = {
  'user-agent': USER_AGENT,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  dnt: '1',
  'upgrade-insecure-requests': '1',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
}

const LAUNCH_ARGS = ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-infobars', '--disable-dev-shm-usage']

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
`

let browser: Browser | null = null

let launching: Promise<Browser> | null = null

let handlersInstalled = false

function closeBrowser(): void {
  const instance = browser
  browser = null
  launching = null
  if (instance) void instance.close().catch(() => {})
}

async function launchBrowser(): Promise<Browser> {
  const instance = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS })
  browser = instance
  if (!handlersInstalled) {
    handlersInstalled = true
    process.once('exit', closeBrowser)
    const SIGNAL_CODES: Record<string, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.once(signal, () => {
        closeBrowser()
        process.exit(SIGNAL_CODES[signal])
      })
    }
  }
  return instance
}

async function getBrowser(): Promise<Browser> {
  if (browser?.connected) return browser
  if (!launching) {
    launching = launchBrowser().finally(() => {
      launching = null
    })
  }
  return launching
}

const PAGE_LIMIT = 4
let pagesOpen = 0
const waiters: Array<() => void> = []
async function acquirePageSlot(): Promise<void> {
  if (pagesOpen < PAGE_LIMIT) {
    pagesOpen++
    return
  }
  await new Promise<void>((resolve) => waiters.push(resolve))
}

function releasePageSlot(): void {
  const wake = waiters.shift()
  if (wake) {
    wake()
    return
  }
  pagesOpen--
}

const isPrivateHostname = (hostname: string): boolean => {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '0.0.0.0' || h === '::' || h === '::1') return true
  if (h === '169.254.169.254' || h.startsWith('169.254.')) return true
  if (h.includes(':')) return isPrivateIPv6(h)
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    if (a === 127) return true
    if (a === 10) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 0) return true
  }
  return false
}

const isPrivateIPv6 = (h: string): boolean => {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h)
  if (mapped) return isPrivateHostname(mapped[1] as string)
  const first = h.split(':')[0] ?? ''
  const value = Number.parseInt(first, 16)
  if (Number.isNaN(value)) return false
  if ((value & 0xfe00) === 0xfc00) return true
  if ((value & 0xffc0) === 0xfe80) return true
  return false
}

export const assertSafeUrl = (raw: string, allowPrivate = false): URL => {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Blocked URL (invalid): ${raw}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL (protocol ${parsed.protocol} not allowed): ${raw}`)
  }
  if (!allowPrivate && isPrivateHostname(parsed.hostname)) {
    throw new Error(`Blocked URL (private host): ${raw}`)
  }
  return parsed
}

export interface RenderedPage {
  url: string
  contentType: string
  status: number
  body: string
}

export async function renderPage(url: string, { timeout = 30_000, allowPrivate = false }: { timeout?: number; allowPrivate?: boolean } = {}): Promise<RenderedPage> {
  assertSafeUrl(url, allowPrivate)
  const instance = await getBrowser()
  await acquirePageSlot()
  let page: Awaited<ReturnType<Browser['newPage']>>
  try {
    page = await instance.newPage()
  } catch (error) {
    releasePageSlot()
    throw error
  }
  try {
    await page.setUserAgent(USER_AGENT)
    await page.setExtraHTTPHeaders(BROWSER_HEADERS)
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false })
    await page.evaluateOnNewDocument(ANTI_DETECTION_SCRIPT)
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout })
    if (!response) throw new Error(`No response from ${url}`)
    assertSafeUrl(page.url(), allowPrivate)
    const contentType = response.headers()['content-type']?.split(';')[0]?.trim() ?? ''
    const isHtml = contentType === 'text/html' || contentType === 'application/xhtml+xml'
    const body = isHtml ? await page.content() : await response.text()
    return { url: page.url(), contentType, status: response.status(), body }
  } finally {
    try {
      await page.close()
    } finally {
      releasePageSlot()
    }
  }
}
