import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";
import { ExpandableToolHeader } from "./ExpandableToolHeader";
import type { ReactNode } from "react";
import type { ToolStatus } from "./ToolCall";

type ToolCallShellProps = {
  name: string;
  status: ToolStatus;
  error?: string;
  header?: (hovered: boolean) => ReactNode;
  children?: ReactNode;
  /** Raw message content copied when the tool body is clicked. */
  copyText: string;
  /** Initial collapse state of the tool body (collapsed by default). */
  defaultCollapsed?: boolean;
  /** Whether the header click toggles the body (enabled by default). */
  collapsible?: boolean;
  /** Whether the body is a click-to-copy target (enabled by default). */
  copyable?: boolean;
};

/** Shared wrapper for a tool execution: colored border, name/status header row, and error-or-content body. */
export const ToolCallShell = ({ name, status, error, header, children, copyText, defaultCollapsed, collapsible, copyable }: ToolCallShellProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const borderColor = error ? theme.error : theme.success;

  return (
    <ExpandableToolHeader
      name={name}
      status={status}
      header={header}
      borderColor={borderColor}
      copyText={copyText}
      defaultCollapsed={defaultCollapsed}
      collapsible={collapsible}
      copyable={copyable}
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