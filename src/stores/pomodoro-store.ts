import { createStore } from "@xstate/store-react";
import { notifyCompletion } from "../libs/notify";
import { footerToastStore } from "./footer-toast-store";

export type PomodoroPhase = "IDLE" | "WORK" | "SHORT_BREAK" | "LONG_BREAK";

/** Seconds per phase, as held in store context (user-adjustable on the page). */
export type PomodoroDurations = Record<Exclude<PomodoroPhase, "IDLE">, number>;

/** Default durations in seconds per the Pomodoro spec. */
export const POMODORO_DURATIONS: PomodoroDurations = {
  WORK: 25 * 60,
  SHORT_BREAK: 5 * 60,
  LONG_BREAK: 15 * 60,
};

/** Stepper bounds/steps (minutes) for the duration pickers on the page. */
export const POMODORO_MIN_MINUTES = 5;
export const POMODORO_MAX_MINUTES = 90;
export const POMODORO_STEP_MINUTES = 5;

/** Long break after every N completed work sessions. */
const POMODOROS_PER_LONG_BREAK = 4;

export type PomodoroState = {
  phase: PomodoroPhase;
  /** Seconds per phase; defaults to POMODORO_DURATIONS, editable on the page. */
  durations: PomodoroDurations;
  /** Total seconds of the current assigned timer (0 when idle). */
  duration: number;
  /** Seconds remaining in the current countdown. */
  timeLeft: number;
  /** Completed WORK sessions (resets after a long break). */
  pomodoroCount: number;
  /** True while the countdown runs; false when paused/idle. */
  isActive: boolean;
  /** Auto-start the next timer when one completes. */
  autoStart: boolean;
  /** Wall-clock deadline of the running timer; null while paused/idle. */
  endsAt: number | null;
};

/** `mm:ss` display for the big timer. */
export const formatMmSs = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** `23m21s`-style label (minutes + seconds) for the header tab. */
export const formatPomodoroLabel = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
};

let tickTimer: ReturnType<typeof setInterval> | undefined;

function startTicking(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => pomodoroStore.trigger.tick(), 1000);
}

function stopTicking(): void {
  if (!tickTimer) return;
  clearInterval(tickTimer);
  tickTimer = undefined;
}

/**
 * Pomodoro state machine: IDLE -> WORK -> SHORT_BREAK/LONG_BREAK -> WORK ...
 * The countdown is deadline-based: each tick recomputes `timeLeft` from
 * `endsAt`, so throttled timers can't lose time. The store is a module
 * singleton, so timers keep running (and notify on completion) even when no
 * page renders them. Resetting during WORK discards the session without
 * counting it toward `pomodoroCount`.
 */
export const pomodoroStore = createStore({
  context: {
    phase: "IDLE",
    durations: { ...POMODORO_DURATIONS },
    duration: 0,
    timeLeft: 0,
    pomodoroCount: 0,
    isActive: false,
    autoStart: true,
    endsAt: null,
  } as PomodoroState,
  on: {
    start: (s: PomodoroState) => {
      startTicking();
      // A parked timer (auto-start off, phase complete) resumes its own phase;
      // only a truly idle store (or a reset) begins a fresh WORK session.
      if (s.phase !== "IDLE" && !s.isActive && s.timeLeft === s.duration) {
        return { ...s, isActive: true, endsAt: Date.now() + s.timeLeft * 1000 };
      }
      return begin(s, "WORK");
    },
    pause: (s: PomodoroState) => {
      if (!s.isActive) return s;
      stopTicking();
      return { ...s, isActive: false, endsAt: null };
    },
    resume: (s: PomodoroState) => {
      if (s.isActive || s.phase === "IDLE" || s.timeLeft <= 0) return s;
      startTicking();
      return { ...s, isActive: true, endsAt: Date.now() + s.timeLeft * 1000 };
    },
    /** Abandon the current timer; WORK sessions reset this way don't count. */
    reset: (s: PomodoroState): PomodoroState => {
      stopTicking();
      return {
        ...s,
        phase: "IDLE",
        duration: 0,
        timeLeft: 0,
        isActive: false,
        endsAt: null,
      };
    },
    /** Skip to the next phase without counting the abandoned WORK session. */
    skip: (s: PomodoroState) => (s.phase === "IDLE" ? s : complete(s, { counts: false })),
    toggleAutoStart: (s: PomodoroState) => ({ ...s, autoStart: !s.autoStart }),
    /**
     * Change one phase's duration. Applies from the next timer onward; a
     * fresh, untouched timer of the same phase (idle or paused at full) is
     * refreshed immediately. Running timers finish on their current length.
     */
    setDurations: (
      s: PomodoroState,
      e: { phase: Exclude<PomodoroPhase, "IDLE">; seconds: number },
    ): PomodoroState => {
      const seconds = Math.max(60, Math.min(POMODORO_MAX_MINUTES * 60, Math.floor(e.seconds)));
      if (seconds === s.durations[e.phase]) return s;
      const durations = { ...s.durations, [e.phase]: seconds };
      if (s.phase === e.phase && !s.isActive && s.timeLeft === s.duration) {
        return { ...s, durations, duration: seconds, timeLeft: seconds };
      }
      return { ...s, durations };
    },
    tick: (s: PomodoroState) => {
      if (!s.isActive || s.endsAt === null) return s;
      const timeLeft = Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000));
      return timeLeft > 0 ? { ...s, timeLeft } : complete(s, { counts: true });
    },
  },
});

/** Enter `phase` with its full duration and a fresh deadline. */
function begin(s: PomodoroState, phase: Exclude<PomodoroPhase, "IDLE">): PomodoroState {
  const duration = s.durations[phase];
  return {
    ...s,
    phase,
    duration,
    timeLeft: duration,
    isActive: true,
    endsAt: Date.now() + duration * 1000,
  };
}

/** Fire notifications for a finished timer, then transition to the next phase. */
function complete(s: PomodoroState, { counts }: { counts: boolean }): PomodoroState {
  stopTicking();
  const finishedWork = s.phase === "WORK" && counts;
  // Work completion increments the counter; a finished break resets it
  // (per spec, the count resets before the next WORK after a break).
  const nextCount = finishedWork
    ? s.pomodoroCount + 1
    : s.phase === "WORK"
      ? s.pomodoroCount
      : 0;
  const nextPhase: Exclude<PomodoroPhase, "IDLE"> = finishedWork
    ? nextCount % POMODOROS_PER_LONG_BREAK === 0
      ? "LONG_BREAK"
      : "SHORT_BREAK"
    : "WORK";

  if (finishedWork) {
    footerToastStore.trigger.show({
      message: `Pomodoro ${nextCount} complete — time for a break`,
    });
    notifyCompletion("Pomodoro complete — take a break");
  } else {
    footerToastStore.trigger.show({ message: "Pomodoro timer finished" });
    notifyCompletion(s.phase === "WORK" ? "Work session ended" : "Break finished — back to work");
  }

  if (!s.autoStart) {
    // Park on the next phase with a full timer, paused and ready to start.
    return {
      ...s,
      phase: nextPhase,
      duration: s.durations[nextPhase],
      timeLeft: s.durations[nextPhase],
      pomodoroCount: nextCount,
      isActive: false,
      endsAt: null,
    };
  }
  return begin({ ...s, pomodoroCount: nextCount }, nextPhase);
}
