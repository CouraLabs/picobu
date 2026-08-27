import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { CodeOutput } from "../CodeOutput";
import { ToolCallShell } from "../ToolCallShell";
import type { ReadToolCallProps } from "../types";

export const ReadToolCall = ({ path, range, status, output, error, filetype }: ReadToolCallProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const loc = range ? `${path}:${range.from ?? ""}${range.to ? `:${range.to}` : ""}` : path;
  const trimmed = output?.trim();

  return (
    <ToolCallShell
      name="Read"
      status={status}
      error={error}
      header={<text selectable={false} fg={theme.textMuted}>{loc}</text>}
    >
      {trimmed ? <CodeOutput filetype={filetype} content={trimmed} /> : null}
    </ToolCallShell>
  );
};