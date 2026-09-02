import { useState, type ReactNode } from "react";
import type { ColorInput } from "@opentui/core";
import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";
import { useCopyableMessage } from "../../hooks/useCopyableMessage";
import type { ToolStatus } from "./ToolCall";

export type ExpandableToolHeaderProps = {
  name: string;
  status: ToolStatus;
  /** Extra header info (path, pattern, command…) recolored with the rest of the header on hover. */
  header?: (hovered: boolean) => ReactNode;
  body: ReactNode;
  borderColor: ColorInput;
  /** Raw message content copied when the tool body is clicked. */
  copyText: string;
  /** Initial collapse state; tools that should always show their body pass `false`. */
  defaultCollapsed?: boolean;
  /** Whether clicking the header toggles the body; `false` pins the body open/closed. */
  collapsible?: boolean;
  /** Whether the body is a click-to-copy target; `false` for interactive bodies. */
  copyable?: boolean;
};

/**
 * Collapsible wrapper for tool executions. Defaults to collapsed so the
 * conversation stays compact; clicking the header row toggles the body (unless
 * `collapsible` is `false`). Only
 * the body collapses — the header is always visible. Hovering the header
 * recolors the caret, tool name, and extra header info (and, when open, the left border) in
 * `theme.accent`. The body is a copy target: hover highlights it in
 * `theme.backgroundElement` and clicking copies the full tool result.
 */
export const ExpandableToolHeader = ({ name, status, header, body, borderColor, copyText, defaultCollapsed = true, collapsible = true, copyable = true }: ExpandableToolHeaderProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [hovered, setHovered] = useState(false);
  const copy = useCopyableMessage(copyText);
  const accent = hovered ? theme.accent : borderColor;
  const nameColor = hovered ? theme.accent : status === "success" ? theme.success : theme.error;

  return (
    <box id="tool-expandable" flexDirection="column">
      <box
        flexDirection="row"
        gap={1}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseDown={() => {
          if (!collapsible) return;
          setCollapsed((a) => !a);
        }}
      >
        <text selectable={false} fg={accent}>
          {!collapsed ? '┏' : "⏵"}
        </text>
        <text selectable={false} fg={nameColor}>{name.toUpperCase()}</text>
        {header?.(hovered)}
      </box>
      {!collapsed && body ? (
        <box
          id="tool-body"
          flexDirection="column"
          borderStyle="heavy"
          border={["left"]}
          borderColor={accent}
          paddingX={1}
          {...(copyable
            ? {
                backgroundColor: copy.backgroundColor,
                onMouseOver: copy.onMouseOver,
                onMouseOut: copy.onMouseOut,
                onMouseDown: copy.onMouseDown,
              }
            : {})}
        >
          {body}
        </box>
      ) : null}
    </box>
  );
};