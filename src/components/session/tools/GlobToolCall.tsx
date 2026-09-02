import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { ScrollableOutput } from "../ScrollableOutput";
import { ToolCallShell } from "./ToolCallShell";
import type { ToolStatus } from "../ToolCall";

export type GlobToolCallProps = {
  status: ToolStatus;
  pattern: string;
  output?: string;
  error?: string;
};

export const GlobToolCall = ({ pattern, status, output, error, copyText }: GlobToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  return (
    <ToolCallShell
      name="Glob"
      status={status}
      error={error}
      copyText={copyText}
      header={(hovered) => <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>{pattern}</text>}
    >
      {output?.trim() ? (
        <ScrollableOutput>
          <text selectable={false} fg={theme.text}>{output}</text>
        </ScrollableOutput>
      ) : null}
    </ToolCallShell>
  );
};