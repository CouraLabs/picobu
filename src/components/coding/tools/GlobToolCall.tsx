import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { ScrollableOutput } from "../ScrollableOutput";
import { ToolCallShell } from "../ToolCallShell";
import type { GlobToolCallProps } from "../types";

export const GlobToolCall = ({ pattern, status, output, error }: GlobToolCallProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  return (
    <ToolCallShell
      name="Glob"
      status={status}
      error={error}
      header={<text selectable={false} fg={theme.textMuted}>{pattern}</text>}
    >
      {output?.trim() ? (
        <ScrollableOutput>
          <text selectable={false} fg={theme.text}>{output}</text>
        </ScrollableOutput>
      ) : null}
    </ToolCallShell>
  );
};