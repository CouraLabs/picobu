/**
 * Normalize any thrown value into a user-facing report: a one-line message
 * plus optional technical detail (status code, URL, response body, cause
 * chain). Provider errors from the AI SDK are `AI_APICallError`-shaped —
 * plain `Error`s carrying `statusCode` / `url` / `responseBody` fields —
 * possibly wrapped in a generic error via `cause`, so the fields are looked
 * up through the cause chain.
 */

/** Maximum characters shown for a raw (non-JSON) response body. */
const MAX_BODY = 400;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const clip = (text: string): string =>
  text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}…` : text;

/** Extract the human-meaningful summary from a response body: a nested
 * `error.message` when the body is JSON, otherwise the raw (clipped) text. */
const responseSummary = (body: string): string | null => {
  const text = body.trim();
  if (!text) return null;
  try {
    const json = asRecord(JSON.parse(text));
    const nested = asRecord(json?.error);
    const summary = str(nested?.message) ?? str(json?.message) ?? str(json?.detail);
    if (summary) return clip(summary);
  } catch {
    // Not JSON — surface the raw body.
  }
  return clip(text);
};

/** First record in the error's cause chain carrying API-call fields. */
const findApiRecord = (error: Error): Record<string, unknown> | null => {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    const record = asRecord(current) ?? {};
    if (typeof record.statusCode === "number" || str(record.responseBody)) return record;
    current = current.cause;
  }
  return null;
};

export type ErrorReport = {
  /** Single-line summary, e.g. `AI_APICallError · HTTP 401 · Invalid API key`. */
  message: string;
  /** Multi-line technical detail, or null when nothing beyond the message. */
  detail: string | null;
};

export const describeError = (error: unknown): ErrorReport => {
  if (!(error instanceof Error)) return { message: String(error), detail: null };

  const apiRecord = findApiRecord(error);
  const record = apiRecord ?? asRecord(error) ?? {};

  const header: string[] = [];
  if (error.name && error.name !== "Error") header.push(error.name);
  if (typeof record.statusCode === "number") header.push(`HTTP ${record.statusCode}`);
  const message = header.length ? `${header.join(" · ")} · ${error.message}` : error.message;

  const detail: string[] = [];
  const url = str(record.url);
  if (url) detail.push(`url: ${url}`);
  const body = str(record.responseBody);
  if (body) {
    const summary = responseSummary(body);
    if (summary) detail.push(summary);
  }
  // When the API fields came from the cause chain itself, the cause is
  // already represented; only surface a bare cause for unwrapped errors.
  if (!apiRecord) {
    const cause = error.cause instanceof Error ? error.cause : null;
    if (cause?.message && cause.message !== error.message) detail.push(`cause: ${cause.message}`);
  }

  return { message, detail: detail.length ? detail.join("\n") : null };
};

/** Parse a serialized error report (message + detail lines, as produced by
 * `formatStreamError` in the loop) back into a structured report. */
export const reportFromText = (text: string): ErrorReport => {
  const trimmed = text.trim();
  const lines = trimmed.split("\n");
  const message = lines[0]?.trim() || trimmed;
  const detail = lines.slice(1).join("\n").trim();
  return { message, detail: detail || null };
};

/** Tag a report with the session it failed in — errors surface in a shared
 * UI, so the id pinpoints which session/tab produced them. */
export const withSessionId = (report: ErrorReport, sessionId: string | undefined): ErrorReport => {
  if (!sessionId) return report;
  const line = `session: ${sessionId}`;
  return { ...report, detail: report.detail ? `${report.detail}\n${line}` : line };
};
