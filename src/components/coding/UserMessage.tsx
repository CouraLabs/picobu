import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";
import { icons } from "../symbols/icons";

export type UserMessageProps = {
  text: string;
};

export const UserMessage = ({ text }: UserMessageProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  return (
    <box id="user" flexDirection="row" gap={1} marginLeft={1}>
      <text fg={theme.text}>{icons.arrows.rightChevron} {text}</text>
    </box>
  );
};