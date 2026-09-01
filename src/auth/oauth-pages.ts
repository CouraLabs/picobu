/**
 * Minimal success/error HTML for the local OAuth callback windows. Ported from
 * earendil-works/pi `oauth/oauth-page.ts` (same dark theme, no logo markup).
 */

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const renderPage = (options: { title: string; heading: string; message: string; details?: string }): string => {
  const title = escapeHtml(options.title);
  const heading = escapeHtml(options.heading);
  const message = escapeHtml(options.message);
  const details = options.details ? escapeHtml(options.details) : undefined;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { --text: #fafafa; --text-dim: #a1a1aa; --page-bg: #09090b; }
    * { box-sizing: border-box; }
    html { color-scheme: dark; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 24px; background: var(--page-bg); color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, sans-serif; text-align: center; }
    main { width: 100%; max-width: 520px; }
    h1 { margin: 0 0 10px; font-size: 26px; font-weight: 650; color: var(--text); }
    p { margin: 0; line-height: 1.7; color: var(--text-dim); font-size: 15px; }
    .details { margin-top: 14px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
      "Liberation Mono", "Courier New", monospace; font-size: 13px; color: var(--text-dim);
      white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <main>
    <h1>${heading}</h1>
    <p>${message}</p>
    ${details ? `<div class="details">${details}</div>` : ""}
  </main>
</body>
</html>`;
};

export const oauthSuccessHtml = (message: string): string =>
  renderPage({ title: "Authentication successful", heading: "Authentication successful", message });

export const oauthErrorHtml = (message: string, details?: string): string =>
  renderPage({ title: "Authentication failed", heading: "Authentication failed", message, details });