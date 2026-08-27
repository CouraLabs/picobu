import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { CodeOutput } from "../CodeOutput";
import { ToolCallShell } from "../ToolCallShell";
import type { GrepToolCallProps } from "../types";

export const GrepToolCall = ({ pattern, path, status, output, error, filetype }: GrepToolCallProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  return (
    <ToolCallShell
      name="Grep"
      status={status}
      error={error}
      header={
        <>
          <text selectable={false} fg={theme.textMuted}>/{pattern}/</text>
          {path ? <text fg={theme.textMuted}>{path}</text> : null}
        </>
      }
    >
      <CodeOutput filetype={filetype} content={output ?? ""} />
    </ToolCallShell>
  );
};