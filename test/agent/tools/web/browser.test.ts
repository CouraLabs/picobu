import { describe, expect, test } from "bun:test";
import { renderPage } from "@agent/tools/web/browser.ts";

describe("browser identity", () => {
  // Echoes every request header back as plain text so tests can assert the
  // exact UA/headers headless Chrome sends.
  const echoServer = Bun.serve({
    port: 0,
    fetch(req) {
      const headers = Object.fromEntries(req.headers.entries());
      return new Response(JSON.stringify(headers), { headers: { "content-type": "text/plain" } });
    },
  });

  test("sends a real Chrome user agent (no HeadlessChrome marker)", async () => {
    const rendered = await renderPage(`${echoServer.url.href}ua`);
    const headers = JSON.parse(rendered.body) as Record<string, string>;
    expect(headers["user-agent"]).toContain("Chrome/124.0.0.0 Safari/537.36");
    expect(headers["user-agent"]).not.toContain("HeadlessChrome");
  });

  test("sends Chrome client-hint headers without overriding Sec-Fetch-*", async () => {
    const rendered = await renderPage(`${echoServer.url.href}headers`);
    const headers = JSON.parse(rendered.body) as Record<string, string>;
    expect(headers["sec-ch-ua"]).toContain('"Chromium";v="124"');
    expect(headers["sec-ch-ua-platform"]).toBe('"macOS"');
    // Chrome computes Sec-Fetch-* per request (a top-level navigation is
    // `dest: document`); overriding them globally is a bot fingerprint, so
    // they must come from the browser, not from us.
    expect(headers["sec-fetch-dest"]).toBe("document");
    expect(headers["sec-fetch-mode"]).toBe("navigate");
    expect(headers["accept-language"]).toBe("en-US,en;q=0.9");
  });

  test("navigator.webdriver is false and not an own property (evades _.has checks)", async () => {
    const webdriverServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          `<html><body><script>
            document.body.textContent = JSON.stringify({
              webdriver: navigator.webdriver,
              ownProp: Object.prototype.hasOwnProperty.call(navigator, "webdriver"),
              protoProp: Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(navigator), "webdriver"),
            });
          </script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    const rendered = await renderPage(`${webdriverServer.url.href}wd`);
    expect(rendered.body).toContain('"webdriver":false');
    expect(rendered.body).toContain('"ownProp":false');
    expect(rendered.body).toContain('"protoProp":true');
  });

  test("window.chrome exposes the runtime surface real Chrome has", async () => {
    const chromeServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          `<html><body><script>
            const c = window.chrome ?? {};
            document.body.textContent = JSON.stringify({
              hasChrome: Boolean(window.chrome),
              hasApp: Boolean(c.app),
              appIsInstalled: c.app?.isInstalled,
              hasRuntime: Boolean(c.runtime),
              hasCsi: typeof c.csi,
              hasLoadTimes: typeof c.loadTimes,
            });
          </script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    const rendered = await renderPage(`${chromeServer.url.href}chrome`);
    expect(rendered.body).toContain('"hasChrome":true');
    expect(rendered.body).toContain('"hasApp":true');
    expect(rendered.body).toContain('"appIsInstalled":false');
    expect(rendered.body).toContain('"hasRuntime":true');
    expect(rendered.body).toContain('"hasCsi":"function"');
    expect(rendered.body).toContain('"hasLoadTimes":"function"');
  });
});
