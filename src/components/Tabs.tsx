import { TextAttributes } from "@opentui/core";
import { useState } from "react";
import { useTheme } from "../hooks/useTheme";

/** Top navigation pages (Header). */
export type PageId = "SESSIONS" | "CONFIG" | "3D";

export const NAV_TABS: { id: PageId; label: string }[] = [
  { id: "SESSIONS", label: "SESSIONS" },
  { id: "CONFIG", label: "CONFIG" },
  { id: "3D", label: "3D" },
];

/** Inner session tabs (SessionPage). */
export type CodingTabId = "coding" | "persistent";

export const SESSION_TABS: { id: CodingTabId; label: string }[] = [
  { id: "coding", label: "CODING" },
  { id: "persistent", label: "PERSISTENT" },
];

/**
 * Tab visual variants:
 * - `nav` — top page navigation: rounded tabs, bordered on top/left/right.
 * - `session` — inline session switcher: heavy right-border separators.
 */
export type TabsVariant = "nav" | "session";

type TabsProps<T extends string> = {
  id?: string;
  items: { id: T; label: string }[];
  current: T;
  onChange: (id: T) => void;
  variant?: TabsVariant;
};

/**
 * Generic tab row shared by the header navigation and the session switcher.
 * The `variant` option selects between the two historical stylings (the former
 * `Tab` and `SessionTabs` components).
 */
export const Tabs = <T extends string>({ id, items, current, onChange, variant = "nav" }: TabsProps<T>) => {
  const { theme } = useTheme();
  const [hover, setHover] = useState("");
  const nav = variant === "nav";
  const color = (tab: string) =>
    hover === tab && current !== tab
      ? theme.accent
      : current === tab
        ? nav
          ? theme.text
          : theme.secondary
        : theme.border;

  return (
    <box
      id={id ?? (nav ? "tabs" : "coding-tabs")}
      gap={nav ? 0 : 1}
      flexDirection="row"
      alignItems="flex-start"
      justifyContent="flex-start"
    >
      {items.flatMap((tab) => [
        <box
          key={tab.id}
          onMouseDown={() => onChange(tab.id)}
          onMouseOver={() => setHover(tab.id)}
          onMouseOut={() => setHover("")}
          border={nav ? ["top", "left", "right"] : []}
          paddingX={nav ? 2 : 0}
          borderStyle={nav ? "rounded" : "heavy"}
          borderColor={color(tab.id)}
        >
          <text fg={color(tab.id)} selectable={false} id={`tab-${tab.id}`} attributes={TextAttributes.BOLD}>
            {tab.label}
          </text>
        </box>,
      ])}
    </box>
  );
};

/** Top page navigation (Header). */
export const NavTabs = ({ current, onChange }: { current: PageId; onChange: (page: PageId) => void }) => (
  <Tabs id="tabs" items={NAV_TABS} current={current} onChange={onChange} variant="nav" />
);

/** Inner coding/persistent session switcher (SessionPage). */
export const SessionTabs = ({
  current,
  onChange,
}: {
  current: CodingTabId;
  onChange: (tab: CodingTabId) => void;
}) => <Tabs id="coding-tabs" items={SESSION_TABS} current={current} onChange={onChange} variant="session" />;
