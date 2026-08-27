import { useSelector } from "@xstate/store-react";
import { Tab } from "./Tab";
import { themeStore } from "../stores/theme-store";
import { Theme } from "./Theme";

export type HeaderProps = {
  page: string;
  onPageChange: (page: string) => void;
};

export const Header = ({ page, onPageChange }: HeaderProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  return (
    <box
      id="header"
      flexShrink={0}
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      border={['top', 'bottom']}
      borderColor={theme.border}
      paddingX={1}
      marginX={1}
    >
      <Tab current={page} onChange={onPageChange} />
      <Theme />
    </box>
  );
};
