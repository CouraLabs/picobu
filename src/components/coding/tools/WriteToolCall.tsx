import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { CodeOutput } from "../CodeOutput";
import { ToolCallShell } from "../ToolCallShell";
import { detectFiletype } from "../../../libs/filetype";
import type { WriteToolCallProps } from "../types";

export const WriteToolCall = ({ path, status, content, error }: WriteToolCallProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  return (
    <ToolCallShell
      name="Write"
      status={status}
      error={error}
      header={<text selectable={false} fg={theme.textMuted}>{path}</text>}
    >
      {content?.length ? <CodeOutput filetype={detectFiletype(path)} content={content} /> : null}
    </ToolCallShell>
  );
};