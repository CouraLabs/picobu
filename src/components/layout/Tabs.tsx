import { TextAttributes } from "@opentui/core";
import { useState } from "react";
import { useSelector } from "@xstate/store-react";
import { useTheme } from "../../hooks/useTheme";
import { formatPomodoroLabel, pomodoroStore } from "../../stores/pomodoro-store";

/** Top navigation pages (Header). */
export type PageId = "SESSIONS" | "WHATSAPP" | "POMODORO" | "CRONS" | "3D";

/** Header nav labels; `POMODORO` gets a live countdown suffix (see NavTabs). */
export const NAV_TABS: { id: PageId; label: string }[] = [
  { id: "SESSIONS", label: "SESSIONS" },
  { id: "WHATSAPP", label: "WHATSAPP" },
  { id: "POMODORO", label: "POMODORO" },
  { id: "CRONS", label: "CRONS" },
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

/** Top page navigation (Header). The POMODORO tab shows the live timer countdown. */
export const NavTabs = ({ current, onChange }: { current: PageId; onChange: (page: PageId) => void }) => {
  // The pomodoro tick runs in the module store even when this view is not
  // rendered, so the tab label keeps counting while the user is elsewhere.
  const { phase, timeLeft } = useSelector(pomodoroStore, (s) => s.context);
  const items = NAV_TABS.map((t) =>
    t.id === "POMODORO" && phase !== "IDLE" && timeLeft > 0
      ? { ...t, label: `POMODORO (${formatPomodoroLabel(timeLeft)})` }
      : t,
  );
  return <Tabs id="tabs" items={items} current={current} onChange={onChange} variant="nav" />;
};

/** Inner coding/persistent session switcher (SessionPage). */
export const SessionTabs = ({
  current,
  onChange,
}: {
  current: CodingTabId;
  onChange: (tab: CodingTabId) => void;
}) => <Tabs id="coding-tabs" items={SESSION_TABS} current={current} onChange={onChange} variant="session" />;
