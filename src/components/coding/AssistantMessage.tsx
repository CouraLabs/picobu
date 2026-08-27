import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";

export type AssistantMessageProps = {
  markdown: string;
  isStreaming: boolean;
};

export const AssistantMessage = ({ markdown, isStreaming }: AssistantMessageProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const syntax = useSelector(themeStore, (s) => s.context.syntax);

  return (
    <box id="assistant" flexDirection="row" borderStyle="heavy" gap={1} marginLeft={1} paddingLeft={1} border={["left"]} borderColor={theme.primary}>
      <markdown
        flexGrow={1}
        flexShrink={1}
        syntaxStyle={syntax}
        flexWrap="wrap"
        conceal
        content={markdown}
        streaming={false}
      />
    </box>
  );
};