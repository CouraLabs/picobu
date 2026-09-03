import { describe, expect, test } from "bun:test";
import {
  isDue,
  parseFrequency,
  parseTimeOfDay,
  scheduleLabel,
  type CronJob,
} from "@cron/schedule.ts";

const MIN = 60_000;

const baseJob = (overrides: Partial<CronJob> = {}): CronJob => ({
  id: "t1",
  name: "test",
  origin: "cron",
  enabled: true,
  createdAt: new Date("2026-03-15T10:00:00").getTime(),
  schedule: { type: "interval", everyMinutes: 30 },
  action: { type: "notification", message: "m" },
  lastRunAt: 0,
  runCount: 0,
  ...overrides,
});

describe("parseFrequency / parseTimeOfDay", () => {
  test("parses unit and keyword frequencies into minutes", () => {
    expect(parseFrequency("45m")).toBe(45);
    expect(parseFrequency("every 2h")).toBe(120);
    expect(parseFrequency("hourly")).toBe(60);
    expect(parseFrequency("daily")).toBe(1440);
    expect(parseFrequency("soon")).toBeNull();
    expect(parseFrequency("")).toBeNull();
  });

  test("parseTimeOfDay validates HH:MM", () => {
    expect(parseTimeOfDay("9:30")).toEqual({ hours: 9, minutes: 30 });
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("nope")).toBeNull();
  });
});

describe("isDue", () => {
  test("interval jobs fire once everyMinutes elapsed since creation", () => {
    const created = new Date("2026-03-15T10:00:00").getTime();
    expect(isDue(baseJob({ createdAt: created }), created + 29 * MIN)).toBe(false);
    expect(isDue(baseJob({ createdAt: created }), created + 30 * MIN)).toBe(true);
  });

  test("interval anchor switches to lastRunAt after firing", () => {
    const now = Date.now();
    expect(isDue(baseJob({ lastRunAt: now - 20 * MIN }), now)).toBe(false);
    expect(isDue(baseJob({ lastRunAt: now - 31 * MIN }), now)).toBe(true);
  });

  test("disabled jobs never fire", () => {
    expect(isDue(baseJob({ enabled: false }), Date.now() + 86_400_000)).toBe(false);
  });

  test("daily jobs fire once per local day after HH:MM", () => {
    const daily = (overrides: Partial<CronJob> = {}): CronJob => ({
      ...baseJob({ ...overrides, schedule: { type: "daily", time: "09:30" } }),
    });
    const before = new Date("2026-03-15T08:59:00").getTime();
    const after = new Date("2026-03-15T09:31:00").getTime();
    const firedToday = new Date("2026-03-15T09:30:10").getTime();
    expect(isDue(daily(), before)).toBe(false);
    expect(isDue(daily(), after)).toBe(true);
    expect(isDue(daily({ lastRunAt: firedToday }), after)).toBe(false);
    expect(
      isDue(daily({ lastRunAt: firedToday }), new Date("2026-03-16T09:31:00").getTime()),
    ).toBe(true);
  });
});

test("scheduleLabel formats both kinds", () => {
  expect(scheduleLabel({ type: "daily", time: "09:30" })).toBe("daily at 09:30");
  expect(scheduleLabel({ type: "interval", everyMinutes: 45 })).toBe("every 45m");
});
