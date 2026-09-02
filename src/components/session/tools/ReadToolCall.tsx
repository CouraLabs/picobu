import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { CodeOutput } from "../CodeOutput";
import { ToolCallShell } from "./ToolCallShell";
import type { ToolStatus } from "../ToolCall";

export type ReadToolCallProps = {
  status: ToolStatus;
  path: string;
  range?: { from?: number; to?: number };
  output?: string;
  filetype?: string;
  error?: string;
};

export const ReadToolCall = ({ path, range, status, output, error, filetype, copyText }: ReadToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const loc = range ? `${path}:${range.from ?? ""}${range.to ? `:${range.to}` : ""}` : path;
  const trimmed = output?.trim();

  return (
    <ToolCallShell
      name="Read"
      status={status}
      error={error}
      copyText={copyText}
      header={(hovered) => <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>{loc}</text>}
    >
      {trimmed ? <CodeOutput filetype={filetype} content={trimmed} /> : null}
    </ToolCallShell>
  );
};