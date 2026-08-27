import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";
import { useCopyableMessage } from "../../hooks/useCopyableMessage";

export type AssistantMessageProps = {
  markdown: string;
  isStreaming: boolean;
};

export const AssistantMessage = ({ markdown, isStreaming }: AssistantMessageProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const syntax = useSelector(themeStore, (s) => s.context.syntax);
  const copy = useCopyableMessage(markdown);

  return (
    <box
      id="assistant"
      flexDirection="row"
      borderStyle="heavy"
      gap={1}
      marginLeft={1}
      paddingLeft={1}
      border={["left"]}
      borderColor={theme.primary}
      backgroundColor={copy.backgroundColor}
      onMouseOver={copy.onMouseOver}
      onMouseOut={copy.onMouseOut}
      onMouseDown={copy.onMouseDown}
    >
      {isStreaming ? <text fg={theme.text}>{markdown}</text> : <markdown
        flexGrow={1}
        flexShrink={1}
        syntaxStyle={syntax}
        conceal
        content={markdown}
      />}
    </box>
  );
};