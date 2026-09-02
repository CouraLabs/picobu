import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";
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
  // Streaming borders pulse via the secondary voice color; settled messages
  // sit muted below the user/assistant voices.
  const borderColor = isStreaming ? theme.secondary : theme.textMuted;
  const timeCalc = time > 1000 ? `${time/1000}s` : `${time}ms`;

  return (
    <box id="thinking-wrapper" flexDirection="column">
      <text selectable={false} flexWrap="no-wrap" height={1} fg={mouse || !collapsed ? borderColor : theme.textMuted} onMouseOver={() => setMouse(true)} onMouseOut={() => setMouse(false)} onMouseDown={() => setCollapsed((a) => !a)}>
        { !collapsed ? '┏' : "⏵" }
        { isStreaming ? " Thinking: " + markdown.slice(Math.max(markdown.length - 10, 0), markdown.length).trim() : " Thoughts - " + timeCalc }
      </text>
      { !collapsed ?
        <box
          id="thinking-wrapper"
          flexDirection="row"
          borderStyle="heavy"
          gap={1}
          paddingX={1}
          border={["left"]}
          borderColor={borderColor}
          backgroundColor={copy.backgroundColor}
          onMouseOver={copy.onMouseOver}
          onMouseOut={copy.onMouseOut}
          onMouseDown={copy.onMouseDown}
        >
          {isStreaming ? <text fg={theme.textMuted}>{markdown}</text> : <markdown
            flexGrow={1}
            flexShrink={1}
            syntaxStyle={syntaxMuted}
            conceal
            content={markdown}
          />}
        </box> : null
      }
    </box>
  );
};