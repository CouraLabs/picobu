import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";
import { ToolHeader } from "./ToolHeader";
import { ExpandableTool } from "./ExpandableTool";
import type { ReactNode } from "react";
import type { ToolStatus } from "./types";

type ToolCallShellProps = {
  name: string;
  status: ToolStatus;
  error?: string;
  header?: ReactNode;
  children?: ReactNode;
};

/** Shared wrapper for a tool execution: colored border, name/status header row, and error-or-content body. */
export const ToolCallShell = ({ name, status, error, header, children }: ToolCallShellProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const borderColor = error ? theme.error : theme.success;

  return (
    <ExpandableTool
      borderColor={borderColor}
      header={
        <ToolHeader name={name} status={status}>
          {header}
        </ToolHeader>
      }
      body={
        error ? (
          <text selectable={false} fg={theme.error}>{error}</text>
        ) : (
          children
        )
      }
    />
  );
};