import { describe, expect, test } from "bun:test";
import { MOTIVATIONAL_PHRASES, pickMotivationalPhrase } from "./MotivationalPhrases";

describe("motivational phrases", () => {
  test("ships exactly 100 unique, non-empty phrases", () => {
    expect(MOTIVATIONAL_PHRASES).toHaveLength(100);
    expect(new Set(MOTIVATIONAL_PHRASES).size).toBe(100);
    for (const phrase of MOTIVATIONAL_PHRASES) {
      expect(phrase.trim().length).toBeGreaterThan(0);
      expect(phrase.length).toBeLessThan(80); // fits one terminal line
    }
  });

  test("pickMotivationalPhrase always returns a phrase from the list", () => {
    for (let i = 0; i < 200; i++) {
      expect(MOTIVATIONAL_PHRASES).toContain(pickMotivationalPhrase());
    }
  });
});
