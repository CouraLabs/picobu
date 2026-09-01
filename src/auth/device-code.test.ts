import { describe, expect, test } from "bun:test";
import { CANCEL_MESSAGE, pollOAuthDeviceCodeFlow } from "./device-code";

describe("pollOAuthDeviceCodeFlow", () => {
  test("polls until the provider reports complete", async () => {
    let calls = 0;
    const value = await pollOAuthDeviceCodeFlow<string>({
      intervalSeconds: 1,
      signal: new AbortController().signal,
      poll: async () => {
        calls += 1;
        return calls === 1 ? { status: "pending" } : { status: "complete", value: "tok" };
      },
    });
    expect(value).toBe("tok");
    expect(calls).toBe(2);
  });

  test("throws immediately for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      pollOAuthDeviceCodeFlow<string>({
        signal: controller.signal,
        poll: async () => ({ status: "pending" }),
      }),
    ).rejects.toThrow(CANCEL_MESSAGE);
  });

  test("times out when the expiry elapses", async () => {
    let calls = 0;
    await expect(
      pollOAuthDeviceCodeFlow<string>({
        expiresInSeconds: 0,
        signal: new AbortController().signal,
        poll: async () => {
          calls += 1;
          return { status: "pending" };
        },
      }),
    ).rejects.toThrow("Device flow timed out");
    expect(calls).toBe(0); // deadline already passed before the first poll
  });

  test("slow_down bumps the interval and surfaces the dedicated timeout", async () => {
    let calls = 0;
    await expect(
      pollOAuthDeviceCodeFlow<string>({
        intervalSeconds: 1,
        expiresInSeconds: 1.5,
        signal: new AbortController().signal,
        poll: async () => {
          calls += 1;
          return { status: "slow_down" };
        },
      }),
    ).rejects.toThrow("slow_down");
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  test("propagates poll failures", async () => {
    await expect(
      pollOAuthDeviceCodeFlow<string>({
        signal: new AbortController().signal,
        poll: async () => ({ status: "failed", message: "authorization_expired" }),
      }),
    ).rejects.toThrow("authorization_expired");
  });
});