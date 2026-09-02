import { memo } from "react";
import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";
import { icons } from "../symbols/icons";

export type UserMessageProps = {
  text: string;
};

// Memoized: settled user messages never change, so per-token parent re-renders skip them.
export const UserMessage = memo(({ text }: UserMessageProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  return (
    <box id="user" flexDirection="row" gap={1}>
      <text fg={theme.text}>{icons.arrows.rightChevron} {text}</text>
    </box>
  );
});