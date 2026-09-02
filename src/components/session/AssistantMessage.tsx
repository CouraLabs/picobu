import { memo } from "react";
import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";
import { useCopyableMessage } from "../../hooks/useCopyableMessage";

export type AssistantMessageProps = {
  markdown: string;
  isStreaming: boolean;
};

// Memoized: all props are primitives, so per-token parent re-renders skip the
// settled `<markdown>` (no re-parse/re-conceal flicker across the transcript).
export const AssistantMessage = memo(({ markdown, isStreaming }: AssistantMessageProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const syntax = useSelector(themeStore, (s) => s.context.syntax);
  const copy = useCopyableMessage(markdown);

  return (
    <box
      id="assistant"
      flexDirection="row"
      borderStyle="heavy"
      gap={1}
      paddingLeft={1}
      border={["left"]}
      borderColor={theme.primary}
      backgroundColor={copy.backgroundColor}
      onMouseOver={copy.onMouseOver}
      onMouseOut={copy.onMouseOut}
      onMouseDown={copy.onMouseDown}
    >
      <markdown
        flexGrow={1}
        flexShrink={1}
        syntaxStyle={syntax}
        conceal={false}
        content={markdown}
        streaming={true}
      />
    </box>
  );
});