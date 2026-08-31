import { NavTabs, type PageId } from "./Tabs";
import { useTheme } from "../hooks/useTheme";
import { Theme } from "./Theme";

export type HeaderProps = {
  page: PageId;
  onPageChange: (page: PageId) => void;
};

export const Header = ({ page, onPageChange }: HeaderProps) => {
  const { theme } = useTheme();

  return (
    <box
      id="header"
      flexShrink={0}
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      border={["bottom"]}
      borderColor={theme.text}
    >
      <NavTabs current={page} onChange={onPageChange} />
      <Theme />
    </box>
  );
};
