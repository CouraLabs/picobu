import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { ToolCallShell } from "../ToolCallShell";
import type { EditToolCallProps } from "../types";

export const EditToolCall = ({ path, message, diff, status, error }: EditToolCallProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const syntax = useSelector(themeStore, (s) => s.context.syntax);

  return (
    <ToolCallShell
      name="Edit"
      status={status}
      error={error}
      header={<text selectable={false} fg={theme.textMuted}>{path}</text>}
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