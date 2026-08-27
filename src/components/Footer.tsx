import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/store-react";
import { themeStore } from "../stores/theme-store";
import { copyToastStore } from "../stores/copy-toast-store";

export const Footer = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const copied = useSelector(copyToastStore, (s) => s.context.visible);
  return (
    <box
      id="footer"
      flexShrink={0}
      border={['bottom', 'top']}
      borderColor={theme.borderSubtle}
      flexDirection="row"
      gap={1}
      paddingX={1}
      marginX={1}
    >
      <text fg={theme.text} attributes={TextAttributes.BOLD}>ctrl c</text>
      <text fg={theme.textMuted} attributes={TextAttributes.DIM}>(exit)</text>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>tab</text>
      <text fg={theme.textMuted} attributes={TextAttributes.DIM}>(agent)</text>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>shift tab</text>
      <text fg={theme.textMuted} attributes={TextAttributes.DIM}>(thinking)</text>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>ctrl m</text>
      <text fg={theme.textMuted} attributes={TextAttributes.DIM}>(models)</text>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>ctrl v</text>
      <text fg={theme.textMuted} attributes={TextAttributes.DIM}>(image)</text>
      {copied && <text fg={theme.success} attributes={TextAttributes.BOLD}>Copied to clipboard!</text>}
    </box>
  );
};
