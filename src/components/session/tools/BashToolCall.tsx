import { useSelector } from "@xstate/store-react";
import { useTerminalDimensions } from "@opentui/react";
import { stringWidth } from "bun";
import { themeStore } from "../../../stores/theme-store";
import { ScrollableOutput } from "../ScrollableOutput";
import { MarqueeText } from "../../ui/MarqueeText";
import { ToolCallShell } from "./ToolCallShell";
import type { ToolStatus } from "../ToolCall";

export type BashToolCallProps = {
  status: ToolStatus;
  command: string;
  cwd?: string;
  output?: string;
  error?: string;
};

/**
 * Header chrome around the command, in cells: app `paddingX` (4), caret + gaps
 * + "BASH" + "$" (10), one gap before the cwd suffix, and one safety cell.
 */
const HEADER_CHROME = 16;

export const BashToolCall = ({ command, cwd, status, output, error, copyText }: BashToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const dims = useTerminalDimensions();
  const commandWidth = Math.max(8, dims.width - HEADER_CHROME - (cwd ? stringWidth(cwd) : 0));

  return (
    <ToolCallShell
      name="Bash"
      status={status}
      error={error}
      copyText={copyText}
      header={(hovered) => (
        <>
          <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>$</text>
          <MarqueeText text={command} width={commandWidth} fg={hovered ? theme.accent : theme.text} />
          {cwd ? <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>{cwd}</text> : null}
        </>
      )}
    >
      <ScrollableOutput>
        <text selectable={false} fg={theme.textMuted}>{output}</text>
      </ScrollableOutput>
    </ToolCallShell>
  );
};
