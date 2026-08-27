import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { ScrollableOutput } from "../ScrollableOutput";
import { ToolCallShell } from "../ToolCallShell";
import type { BashToolCallProps } from "../types";

export const BashToolCall = ({ command, cwd, status, output, error }: BashToolCallProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  return (
    <ToolCallShell
      name="Bash"
      status={status}
      error={error}
      header={
        <>
          <text selectable={false} fg={theme.textMuted}>$</text>
          <text selectable={false} fg={theme.text}>{command}</text>
          {cwd ? <text selectable={false} fg={theme.textMuted}>{cwd}</text> : null}
        </>
      }
    >
      <ScrollableOutput>
        <text selectable={false} fg={theme.textMuted}>{output}</text>
      </ScrollableOutput>
    </ToolCallShell>
  );
};