import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { ToolCallShell } from "../ToolCallShell";
import type { ToolStatus } from "../ToolCall";

export type PlanExitToolCallProps = {
  status: ToolStatus;
  error?: string;
  switchedTo?: string;
  message?: string;
};

/** Plan → Coder handoff marker: a compact, always-open card with the handoff message. */
export const PlanExitToolCall = ({ status, error, switchedTo, message, copyText }: PlanExitToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  return (
    <ToolCallShell
      name="Plan Exit"
      status={status}
      error={error}
      copyText={copyText}
      defaultCollapsed={false}
      collapsible={false}
      header={(hovered) => (
        <text selectable={false} fg={hovered ? theme.accent : theme.success}>
          {switchedTo ? `→ ${switchedTo}` : ""}
        </text>
      )}
    >
      {message ? (
        <text selectable={false} fg={theme.success}>
          {`✓ ${message}`}
        </text>
      ) : (
        <text selectable={false} fg={theme.textMuted}>
          Handed off to the Coder agent — implementing the plan.
        </text>
      )}
    </ToolCallShell>
  );
};