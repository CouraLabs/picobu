import { describe, expect, test } from "bun:test";
import { generatePKCE } from "@auth/pkce.ts";

describe("generatePKCE", () => {
  test("produces a verifier + S256 challenge pair", async () => {
    const { verifier, challenge } = await generatePKCE();
    expect(verifier).toHaveLength(43);
    expect(challenge).toHaveLength(43);
    expect(verifier).not.toBe(challenge);
    // Both must be base64url-safe (RFC 4648 §5) — no padding/+/ or / chars.
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("is random across invocations", async () => {
    const a = await generatePKCE();
    const b = await generatePKCE();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});