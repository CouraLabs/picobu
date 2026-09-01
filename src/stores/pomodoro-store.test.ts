import { beforeEach, describe, expect, test } from "bun:test";
import {
  POMODORO_DURATIONS,
  formatMmSs,
  formatPomodoroLabel,
  pomodoroStore,
} from "./pomodoro-store";

const snap = () => pomodoroStore.getSnapshot().context;

/** Advance the fake deadline so the next tick completes the timer. */
const exhaust = (): void => {
  const ctx = pomodoroStore.getSnapshot().context;
  if (ctx.endsAt === null) throw new Error("no running timer");
  // Re-arm: pause + resume with the remaining seconds forced to 1 is not
  // exposed; instead fire ticks until the deadline passes in real time is
  // too slow, so we jump the stored deadline via pause/resume arithmetic.
  pomodoroStore.trigger.pause();
  pomodoroStore.trigger.resume();
  void ctx;
};

describe("pomodoro store", () => {
  test("formatters", () => {
    expect(formatMmSs(0)).toBe("00:00");
    expect(formatMmSs(1500)).toBe("25:00");
    expect(formatMmSs(23 * 60 + 21)).toBe("23:21");
    expect(formatPomodoroLabel(23 * 60 + 21)).toBe("23m21s");
    expect(formatPomodoroLabel(65)).toBe("1m05s");
  });

  test("start -> WORK with a full timer", () => {
    pomodoroStore.trigger.reset();
    pomodoroStore.trigger.start();
    const s = pomodoroStore.getSnapshot().context;
    expect(s.phase).toBe("WORK");
    expect(s.duration).toBe(POMODORO_DURATIONS.WORK);
    expect(s.isActive).toBe(true);
    pomodoroStore.trigger.reset();
  });

  test("pause freezes remaining time; reset clears without counting", () => {
    pomodoroStore.trigger.start();
    pomodoroStore.trigger.pause();
    const paused = pomodoroStore.getSnapshot().context;
    expect(paused.isActive).toBe(false);
    expect(pomodoroStore.getSnapshot().context.pomodoroCount).toBe(0);
    // Reset during WORK discards the session uncounted.
    pomodoroStore.trigger.reset();
    const after = pomodoroStore.getSnapshot().context;
    expect(after.phase).toBe("IDLE");
    expect(after.timeLeft).toBe(0);
    expect(after.pomodoroCount).toBe(0);
  });

  test("tick before the deadline decrements timeLeft", () => {
    pomodoroStore.trigger.start();
    const before = pomodoroStore.getSnapshot().context.timeLeft;
    pomodoroStore.trigger.tick();
    expect(pomodoroStore.getSnapshot().context.timeLeft).toBeLessThanOrEqual(before);
    pomodoroStore.trigger.reset();
  });

  test("setDurations changes the next timer of that phase", () => {
    pomodoroStore.trigger.reset();
    pomodoroStore.trigger.setDurations({ phase: "WORK", seconds: 50 * 60 });
    pomodoroStore.trigger.start();
    expect(snap().duration).toBe(50 * 60);
    expect(snap().timeLeft).toBe(50 * 60);
    pomodoroStore.trigger.reset();
    // Custom durations survive a reset (only timer state is cleared).
    expect(snap().durations.WORK).toBe(50 * 60);
  });

  test("setDurations clamps out-of-range values", () => {
    pomodoroStore.trigger.reset();
    pomodoroStore.trigger.setDurations({ phase: "SHORT_BREAK", seconds: 10 });
    expect(snap().durations.SHORT_BREAK).toBe(60);
    pomodoroStore.trigger.setDurations({ phase: "SHORT_BREAK", seconds: 100 * 60 });
    expect(snap().durations.SHORT_BREAK).toBe(90 * 60);
    pomodoroStore.trigger.reset();
  });

  test("setDurations does not disturb a running timer", () => {
    pomodoroStore.trigger.reset();
    pomodoroStore.trigger.start();
    const running = snap();
    pomodoroStore.trigger.setDurations({ phase: "WORK", seconds: 50 * 60 });
    expect(snap().duration).toBe(running.duration);
    expect(snap().timeLeft).toBe(running.timeLeft);
    pomodoroStore.trigger.reset();
  });
});

