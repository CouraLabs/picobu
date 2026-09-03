import { describe, expect, test } from "bun:test";
import { decodeJwt, getAccountId } from "@auth/openai.ts";

const b64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const makeToken = (payload: unknown): string => `${b64url({ alg: "none" })}.${b64url(payload)}.sig`;

describe("decodeJwt", () => {
  test("decodes a valid JWT payload", () => {
    const token = makeToken({ sub: "u-1", exp: 123 });
    expect(decodeJwt(token)).toEqual({ sub: "u-1", exp: 123 });
  });

  test("returns null for malformed tokens", () => {
    expect(decodeJwt("not-a-jwt")).toBeNull();
    expect(decodeJwt("a.b")).toBeNull();
    expect(decodeJwt("a.b.c.d")).toBeNull();
  });
});

describe("getAccountId", () => {
  test("extracts the chatgpt account id claim", () => {
    const token = makeToken({
      iss: "auth.openai.com",
      "https://api.openai.com/auth": { chatgpt_account_id: "user-abc123" },
    });
    expect(getAccountId(token)).toBe("user-abc123");
  });

  test("returns null when the claim is missing", () => {
    expect(getAccountId(makeToken({ sub: "u-1" }))).toBeNull();
    expect(getAccountId("garbage")).toBeNull();
  });
});