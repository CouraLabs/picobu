import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { ToolCallShell } from "./ToolCallShell";
import type { ToolStatus } from "../ToolCall";

export type EditToolCallProps = {
  status: ToolStatus;
  path: string;
  message?: string;
  diff?: string;
  error?: string;
};

export const EditToolCall = ({ path, message, diff, status, error, copyText }: EditToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const syntax = useSelector(themeStore, (s) => s.context.syntax);

  return (
    <ToolCallShell
      name="Edit"
      status={status}
      error={error}
      copyText={copyText}
      header={(hovered) => <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>{path}</text>}
    >
      {message ? <text marginX={2} fg={theme.textMuted}>{message}</text> : null}
      {diff ? (
        <box marginX={2} backgroundColor={theme.borderSubtle}>
          <diff filetype="typescript" syntaxStyle={syntax} view="unified" diff={diff} />
        </box>
      ) : null}
    </ToolCallShell>
  );
};