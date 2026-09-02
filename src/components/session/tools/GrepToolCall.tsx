import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { CodeOutput } from "../CodeOutput";
import { ToolCallShell } from "./ToolCallShell";
import type { ToolStatus } from "../ToolCall";

export type GrepToolCallProps = {
  status: ToolStatus;
  pattern: string;
  path?: string;
  output?: string;
  filetype?: string;
  error?: string;
};

export const GrepToolCall = ({ pattern, path, status, output, error, filetype, copyText }: GrepToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  return (
    <ToolCallShell
      name="Grep"
      status={status}
      error={error}
      copyText={copyText}
      header={(hovered) => (
        <>
          <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>/{pattern}/</text>
          {path ? <text fg={hovered ? theme.accent : theme.textMuted}>{path}</text> : null}
        </>
      )}
    >
      <CodeOutput filetype={filetype} content={output ?? ""} />
    </ToolCallShell>
  );
};