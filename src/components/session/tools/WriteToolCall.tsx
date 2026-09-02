import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { CodeOutput } from "../CodeOutput";
import { ToolCallShell } from "./ToolCallShell";
import { detectFiletype } from "../../../libs/filetype";
import type { ToolStatus } from "../ToolCall";

export type WriteToolCallProps = {
  status: ToolStatus;
  path: string;
  output?: string;
  content?: string;
  error?: string;
};

export const WriteToolCall = ({ path, status, content, error, copyText }: WriteToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  return (
    <ToolCallShell
      name="Write"
      status={status}
      error={error}
      copyText={copyText}
      header={(hovered) => <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>{path}</text>}
    >
      {content?.length ? <CodeOutput filetype={detectFiletype(path)} content={content} /> : null}
    </ToolCallShell>
  );
};