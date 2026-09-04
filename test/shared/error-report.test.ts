import { describe, expect, test } from "bun:test";
import { describeError, reportFromText, withSessionId, type ErrorReport } from "@shared/error-report.ts";

describe("error-report", () => {
  test("plain Error keeps its message with no detail", () => {
    const report = describeError(new Error("model unavailable"));
    expect(report.message).toBe("model unavailable");
    expect(report.detail).toBe(null);
  });

  test("plain Error hides the generic name and a redundant cause", () => {
    const error = new Error("outer", { cause: new Error("outer") });
    expect(describeError(error).message).toBe("outer");
    expect(describeError(error).detail).toBe(null);
  });

  test("non-Error values stringify", () => {
    expect(describeError("boom").message).toBe("boom");
    expect(describeError("boom").detail).toBe(null);
  });

  test("API-shaped errors surface name, status, url and a JSON body summary", () => {
    const error = Object.assign(new Error("Invalid API key"), {
      name: "AI_APICallError",
      statusCode: 401,
      url: "https://api.anthropic.com/v1/messages",
      responseBody:
        '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    });
    const report = describeError(error);
    expect(report.message).toBe("AI_APICallError · HTTP 401 · Invalid API key");
    expect(report.detail).toBe(
      "url: https://api.anthropic.com/v1/messages\ninvalid x-api-key",
    );
  });

  test("non-JSON response bodies are shown raw and clipped", () => {
    const error = Object.assign(new Error("upstream failed"), {
      name: "AI_APICallError",
      statusCode: 502,
      responseBody: `<html>${"x".repeat(600)}</html>`,
    });
    const report = describeError(error);
    const detail = report.detail!;
    expect(detail.startsWith("upstream failed") === false).toBe(true);
    expect(detail.length).toBeLessThan(600);
    expect(detail.endsWith("…")).toBe(true);
  });

  test("API fields are found through a wrapped cause chain", () => {
    const inner = Object.assign(new Error("rate limited"), {
      name: "AI_APICallError",
      statusCode: 429,
      responseBody: '{"error":{"message":"too many requests"}}',
    });
    const error = new Error("request failed", { cause: inner });
    const report = describeError(error);
    expect(report.message).toBe("HTTP 429 · request failed");
    expect(report.detail).toBe("too many requests");
  });

  test("reportFromText splits message from detail lines", () => {
    const report = reportFromText("HTTP 401 · Invalid API key\nurl: https://api.example.com\ninvalid key");
    expect(report.message).toBe("HTTP 401 · Invalid API key");
    expect(report.detail).toBe("url: https://api.example.com\ninvalid key");
  });

  test("reportFromText keeps single-line errors detail-free", () => {
    expect(reportFromText("An error occurred.")).toEqual({
      message: "An error occurred.",
      detail: null,
    });
  });

  test("withSessionId appends a session detail line (also to detail-less reports)", () => {
    const bare: ErrorReport = { message: "boom", detail: null };
    expect(withSessionId(bare, "ses_abc").detail).toBe("session: ses_abc");
    expect(withSessionId(bare, "ses_abc").message).toBe("boom");
    const detailed: ErrorReport = { message: "boom", detail: "url: https://api" };
    expect(withSessionId(detailed, "ses_abc").detail).toBe("url: https://api\nsession: ses_abc");
  });

  test("withSessionId is a no-op without a session id", () => {
    const bare: ErrorReport = { message: "boom", detail: null };
    expect(withSessionId(bare, undefined)).toBe(bare);
  });

  test("describeError -> text -> reportFromText round-trips", () => {
    const error = Object.assign(new Error("quota exceeded"), {
      name: "AI_APICallError",
      statusCode: 402,
      url: "https://api.example.com/v1/chat",
      responseBody: '{"error":{"message":"billing required"}}',
    });
    const described = describeError(error);
    const serialized = described.detail
      ? `${described.message}\n${described.detail}`
      : described.message;
    expect(reportFromText(serialized)).toEqual(described);
  });
});
