import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { ScrollableOutput } from "../ScrollableOutput";
import { ToolCallShell } from "../ToolCallShell";
import type { ToolStatus } from "../ToolCall";

export type BashToolCallProps = {
  status: ToolStatus;
  command: string;
  cwd?: string;
  output?: string;
  error?: string;
};

export const BashToolCall = ({ command, cwd, status, output, error, copyText }: BashToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  return (
    <ToolCallShell
      name="Bash"
      status={status}
      error={error}
      copyText={copyText}
      header={(hovered) => (
        <>
          <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>$</text>
          <text selectable={false} fg={hovered ? theme.accent : theme.text}>{command}</text>
          {cwd ? <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>{cwd}</text> : null}
        </>
      )}
    >
      <ScrollableOutput>
        <text selectable={false} fg={theme.textMuted}>{output}</text>
      </ScrollableOutput>
    </ToolCallShell>
  );
};