import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/store-react";
import { themeStore } from "../stores/theme-store";

export type TabProps = {
  current: string,
  onChange: (tab: string) => void
}

export const Tab = ({ current, onChange }: TabProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  const tabs = ["main", "coding"];
  const NAV_SEPARATOR = "|";
  return (
    <box id="tabs" gap={1} flexDirection="row" alignItems="flex-start" justifyContent="flex-start">
      {tabs.flatMap((tab) => [
        <box key={tab} onMouseDown={() => onChange(tab)}>
          <text fg={theme.text} id={`tab-${tab}`} attributes={tab === current ? TextAttributes.BOLD : TextAttributes.DIM}>{tab}</text>
        </box>,
        <text key={`${tab}-sep`} fg={theme.textMuted} attributes={TextAttributes.DIM} selectable={false}>
          {NAV_SEPARATOR}
        </text>,
      ])}
    </box>
  );
};
