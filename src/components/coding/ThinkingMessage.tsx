import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";
import { useHeartbeatColor } from "../../hooks/useHeartbeatColor";
import { icons } from "../symbols/icons";
import { TextAttributes, type SyntaxStyle } from "@opentui/core";
import { useState } from "react";
import { useCopyableMessage } from "../../hooks/useCopyableMessage";

export type ThinkingMessageProps = {
  markdown: string;
  isStreaming: boolean;
  time: number;
};

/** Rendered model reasoning, styled muted to sit below the user/assistant voices. */
export const ThinkingMessage = ({ markdown, isStreaming, time }: ThinkingMessageProps) => {
  const [collapsed, setCollapsed] = useState(true);
  const [mouse, setMouse] = useState(false);
  const copy = useCopyableMessage(markdown);
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const syntaxMuted = useSelector(themeStore, (s) => s.context.syntaxMuted);
  const borderColor = useHeartbeatColor(theme.secondary, theme.textMuted, isStreaming);
  const timeCalc = time > 1000 ? `${time/1000}s` : `${time}ms`;

  return (
    <box id="thinking-wrapper" flexDirection="column">
      <text selectable={false} marginLeft={1} flexWrap="no-wrap" height={1} fg={mouse || !collapsed ? borderColor : theme.textMuted} onMouseOver={() => setMouse(true)} onMouseOut={() => setMouse(false)} onMouseDown={() => setCollapsed((a) => !a)}>
        { !collapsed ? '┏' : "⏵" }
        { isStreaming ? " Thinking: " + markdown.slice(Math.max(markdown.length - 10, 0), markdown.length).trim() : " Thoughts - " + timeCalc }
      </text>
      { !collapsed ?
        <box
          id="thinking-wrapper"
          flexDirection="row"
          borderStyle="heavy"
          gap={1}
          marginLeft={1}
          paddingX={1}
          border={["left"]}
          borderColor={borderColor}
          backgroundColor={copy.backgroundColor}
          onMouseOver={copy.onMouseOver}
          onMouseOut={copy.onMouseOut}
          onMouseDown={copy.onMouseDown}
        >
          <code flexGrow={1} flexShrink={1} syntaxStyle={isStreaming ? undefined as unknown as SyntaxStyle : syntaxMuted} attributes={TextAttributes.DIM} conceal={true} filetype="markdown" content={isStreaming ? markdown : markdown.trim()} streaming={isStreaming}/> 
        </box> : null
      }
    </box>
  );
};