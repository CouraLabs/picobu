import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/store-react";
import { Button } from "../components/ui/Button";
import { useTheme } from "../hooks/useTheme";
import { cronStore, setCronEnabled, loadCrons } from "../cron/cron-store";
import { formatLocalTime, scheduleLabel } from "../cron/schedule";

/** Lists every persisted cron job with an enable/disable toggle. */
export const CronsPage = () => {
  const { theme } = useTheme();
  const jobs = useSelector(cronStore, (s) => s.context.jobs);


  return (
    <box id="crons-page" flexDirection="column" flexGrow={1} paddingX={2} gap={1}>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>Crons</text>
        <text fg={theme.textMuted} selectable={false}>
          {jobs.filter((j) => j.enabled).length}/{jobs.length} enabled — run while the app is open
        </text>
        <box flexGrow={1} />
        <Button onPress={() => void loadCrons()}>Refresh</Button>
      </box>
      <scrollbox scrollY flexGrow={1} flexShrink={1}>
        {jobs.map((job) => (
          <box
            key={job.id}
            flexDirection="row"
            gap={2}
            border={[]}
            paddingY={0}
            flexShrink={0}
          >
            <text fg={job.enabled ? theme.success : theme.textMuted} selectable={false}>
              {job.enabled ? "[on] " : "[off]"}
            </text>
            <box flexDirection="column" flexGrow={1}>
              <text fg={theme.text}>{job.name}</text>
              <text fg={theme.textMuted} selectable={false}>
                {scheduleLabel(job.schedule)} · {job.action.type === "whatsapp" ? `WhatsApp → +${job.action.phone}` : job.action.type === "notification" ? "Desktop notification" : "Agent prompt"} · fired {job.runCount}×{job.lastRunAt > 0 ? ` · last ${formatLocalTime(job.lastRunAt)}` : ""}
              </text>
            </box>
            <Button
              variant={job.enabled ? "error" : "success"}
              onPress={() => void setCronEnabled(job.id, !job.enabled)}
            >
              {job.enabled ? "Disable" : "Enable"}
            </Button>
          </box>
        ))}
        {jobs.length === 0 ? (
          <text fg={theme.textMuted}>
            No crons yet — create alerts with /wwp:alert or reminders with /wwp:reminder
          </text>
        ) : null}
      </scrollbox>
    </box>
  );
};
