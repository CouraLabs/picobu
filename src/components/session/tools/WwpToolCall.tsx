import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { ToolCallShell } from "./ToolCallShell";
import type { ToolStatus } from "../ToolCall";

export type WwpToolCallProps = {
  status: ToolStatus;
  /** Tool name, e.g. `wwp-msg`. */
  tool: string;
  /** One-line summary of the call arguments. */
  summary: string;
  output?: string;
  error?: string;
};

/** Generic renderer for the WhatsApp integration tools (wwp-*). */
export const WwpToolCall = ({
  tool,
  summary,
  status,
  error,
  output,
  copyText,
}: WwpToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  return (
    <ToolCallShell
      name={`WWP ${tool.replace(/^wwp-/, "")}`}
      status={status}
      error={error}
      copyText={copyText}
      header={(hovered) => (
        <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>
          {summary}
        </text>
      )}
    >
      <text selectable fg={theme.textMuted}>
        {output ?? "(no output)"}
      </text>
    </ToolCallShell>
  );
};
