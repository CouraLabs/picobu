import { useSelector } from "@xstate/store-react";
import { useTheme } from "../hooks/useTheme";
import { Button } from "../components/ui/Button";
import {
  POMODORO_MAX_MINUTES,
  POMODORO_MIN_MINUTES,
  POMODORO_STEP_MINUTES,
  formatMmSs,
  pomodoroStore,
  type PomodoroPhase,
} from "../stores/pomodoro-store";

const PHASE_LABEL: Record<PomodoroPhase, string> = {
  IDLE: "Ready",
  WORK: "Focus",
  SHORT_BREAK: "Short break",
  LONG_BREAK: "Long break",
};

const clampMinutes = (m: number): number =>
  Math.max(POMODORO_MIN_MINUTES, Math.min(POMODORO_MAX_MINUTES, m));

/** Labeled −/+ stepper for one phase's duration (minutes). */
const DurationStepper = ({ label, phase }: { label: string; phase: Exclude<PomodoroPhase, "IDLE"> }) => {
  const { theme } = useTheme();
  const minutes = useSelector(pomodoroStore, (s) => Math.round(s.context.durations[phase] / 60));
  const setMinutes = (m: number) =>
    pomodoroStore.trigger.setDurations({ phase, seconds: clampMinutes(m) * 60 });

  return (
    <box flexDirection="column" alignItems="center" gap={0}>
      <text fg={theme.textMuted}>{label}</text>
      <box flexDirection="row" gap={1} alignItems="center">
        <Button bordered={false} onPress={() => setMinutes(minutes - POMODORO_STEP_MINUTES)}>
          −
        </Button>
        <text fg={theme.text} width={5}>
          {`${minutes}m`}
        </text>
        <Button bordered={false} onPress={() => setMinutes(minutes + POMODORO_STEP_MINUTES)}>
          +
        </Button>
      </box>
    </box>
  );
};

/** Pomodoro timer page: big mm:ss countdown + transport controls. */
export const PomodoroPage = () => {
  const { theme } = useTheme();
  const { phase, timeLeft, duration, pomodoroCount, isActive, autoStart, durations } = useSelector(
    pomodoroStore,
    (s) => s.context,
  );

  const phaseColor =
    phase === "WORK" ? theme.primary : phase === "LONG_BREAK" ? theme.info : theme.success;

  const progress = phase !== "IDLE" && duration > 0 ? 1 - timeLeft / duration : 0;

  return (
    <box id="pomodoro-page" flexDirection="column" flexGrow={1} paddingX={2} gap={1}>
      <box flexDirection="column" alignItems="center" flexGrow={1} justifyContent="center" gap={1}>
        <text fg={theme.textMuted}>{PHASE_LABEL[phase]}</text>
        <ascii-font
          text={phase === "IDLE" ? formatMmSs(durations.WORK) : formatMmSs(timeLeft)}
          font="block"
          color={isActive ? phaseColor : theme.textMuted}
          selectable={false}
        />
        <box flexDirection="row" width="100%" height={1} backgroundColor={theme.backgroundElement}>
          <box flexGrow={Math.max(0, Math.min(100, Math.round(progress * 100)))} height={1} backgroundColor={isActive ? theme.primary : theme.textMuted} />
          <box flexGrow={100 - Math.max(0, Math.min(100, Math.round(progress * 100)))} />
        </box>
        <text fg={theme.textMuted}>
          {pomodoroCount} pomodoro{pomodoroCount === 1 ? "" : "s"} completed
        </text>
        <text fg={theme.textMuted}>Auto-start: {autoStart ? "on" : "off"}</text>
      </box>
      <box flexDirection="row" gap={4} justifyContent="center" flexShrink={0}>
        <DurationStepper label="Work" phase="WORK" />
        <DurationStepper label="Short" phase="SHORT_BREAK" />
        <DurationStepper label="Long" phase="LONG_BREAK" />
      </box>
      <box flexDirection="row" gap={2} justifyContent="center" flexShrink={0}>
        {phase === "IDLE" || (!isActive && timeLeft === duration) ? (
          <Button variant="success" onPress={() => pomodoroStore.trigger.start()}>
            Start
          </Button>
        ) : isActive ? (
          <Button variant="warning" onPress={() => pomodoroStore.trigger.pause()}>
            Pause
          </Button>
        ) : (
          <Button variant="success" onPress={() => pomodoroStore.trigger.resume()}>
            Resume
          </Button>
        )}
        <Button variant="error" onPress={() => pomodoroStore.trigger.reset()}>
          Reset
        </Button>
        <Button onPress={() => pomodoroStore.trigger.skip()}>Skip</Button>
        <Button onPress={() => pomodoroStore.trigger.toggleAutoStart()}>Auto-start</Button>
      </box>
    </box>
  );
};
