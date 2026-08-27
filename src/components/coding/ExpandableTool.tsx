import { useState, type ReactNode } from "react";
import type { ColorInput } from "@opentui/core";
import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";
import { icons } from "../symbols/icons";

export type ExpandableToolProps = {
  header: ReactNode;
  body: ReactNode;
  borderColor: ColorInput;
};

/**
 * Collapsible wrapper for tool executions. Defaults to collapsed so the
 * conversation stays compact; clicking the header row toggles the body. Only
 * the body collapses — the header is always visible. Hovering the header
 * highlights the collapse caret and (when open) the left border in `theme.accent`.
 */
export const ExpandableTool = ({ header, body, borderColor }: ExpandableToolProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const [collapsed, setCollapsed] = useState(true);
  const [hovered, setHovered] = useState(false);
  const accent = hovered ? theme.accent : borderColor;

  return (
    <box id="tool-expandable" flexDirection="column" marginLeft={1}>
      <box
        flexDirection="row"
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseDown={() => setCollapsed((a) => !a)}
      >
        <text selectable={false} fg={accent}>
          {!collapsed ? '┏' : "⏵"}
        </text>
        {header}
      </box>
      {!collapsed && body ? (
        <box id="tool-body" flexDirection="column" borderStyle="heavy" border={["left"]} borderColor={accent} paddingX={1}>
          {body}
        </box>
      ) : null}
    </box>
  );
};