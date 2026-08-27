import type { ReactNode } from "react";
import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";
import type { ToolStatus } from "./types";
import { icons } from "../symbols/icons";

type ToolHeaderProps = {
  name: string;
  status: ToolStatus;
  children?: ReactNode;
};

/** Icon + status-colored tool name row; extra info (path, pattern…) passed as children. */
export const ToolHeader = ({ name, status, children }: ToolHeaderProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const color = status === "success" ? theme.success : theme.error;

  return (
    <box flexDirection="row" gap={1}>
      <text selectable={false} fg={color} marginLeft={1}>{name.toUpperCase()}</text>
      {children}
    </box>
  );
};