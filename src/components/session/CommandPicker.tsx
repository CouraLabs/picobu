import { useSelector } from "@xstate/store-react";
import { useTerminalDimensions } from "@opentui/react";
import { themeStore } from "../../stores/theme-store";
import { loopStore } from "../../stores/loop-store";
import { filterCommands, commandModeFor } from "../../harness/commands";
import type { CommandKind } from "../../harness/commands";
import { useSessionBindings } from "../../providers/SessionBindings";
import { TextAttributes } from "@opentui/core";

const BADGE: Record<CommandKind, string> = {
  system: "SYSTEM",
  workflow: "WORKFLOW",
  skill: "SKILL"
};

/** Rows visible at once; the window slides as the selection moves. */
export const MAX_VISIBLE = 5;

/**
 * First visible index of a `maxVisible`-row window over `count` items that
 * keeps `selected` in view (it slides once the selection passes an edge).
 */
export const windowStart = (selected: number, count: number, maxVisible: number): number => {
  if (count <= maxVisible) return 0;
  return Math.max(0, Math.min(selected - (maxVisible - 1), count - maxVisible));
};

/** Clip `value` to `max` chars with a trailing ellipsis when it overflows. */
export const clip = (value: string, max: number): string => {
  if (max <= 0) return "";
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
};

/**
 * Filterable slash-command autocomplete. Presentational only: it does not trap
 * focus, so the prompt textarea keeps typing/filter focus. Reading directly
 * from loopStore re-renders as `commandQuery` changes. `kind` restricts the
 * list to commands available in the active session mode (code/persistent+web).
 *
 * Renders a sliding window of at most `MAX_VISIBLE` rows that follows the
 * selection, one clipped line per command, so long descriptions can never
 * wrap/overlap the surrounding rows.
 */
export const CommandPicker = ({ kind }: { kind: "coding" | "persistent" }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const { commandOpen, commandQuery, commandSelected } = useSelector(
    loopStore,
    (s) => s.context,
  );
  const { frontend } = useSessionBindings();
  const dims = useTerminalDimensions();

  if (!commandOpen) return null;
  const items = filterCommands(commandQuery, commandModeFor(kind, frontend === "web"));
  if (items.length === 0) return null;

  // The selection can fall out of range while the filter narrows the list.
  const selected = Math.min(commandSelected, items.length - 1);
  const start = windowStart(selected, items.length, MAX_VISIBLE);
  const visible = items.slice(start, start + MAX_VISIBLE);

  // Row budget: border(2) + paddingX(2) + gaps. Each row draws
  // "BADGE /name (aliases) description" on a single line.
  const innerWidth = Math.max(0, dims.width - 8);

  return (
    <box
      border
      borderStyle="single"
      title={` Commands (${selected + 1}/${items.length}) `}
      titleColor={theme.accent}
      borderColor={theme.accent}
      height={visible.length + 2}
      paddingX={1}
      flexDirection="column"
    >
      {visible.map((item, i) => {
        const index = start + i;
        const name = `/${item.name}`;
        const aliases = item.aliases.length > 0 ? `(${item.aliases.join(", ")})` : "";
        const used = BADGE[item.kind].length + 1 + name.length + 1 + (aliases ? aliases.length + 1 : 0);
        const description = clip(item.description, innerWidth - used);
        return (
          <box key={`${item.kind}:${item.name}`} flexDirection="row" gap={1} height={1}>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>{BADGE[item.kind]}</text>
            <text fg={index === selected ? theme.accent : theme.text}>{name}</text>
            {aliases && <text fg={theme.textMuted}>{aliases}</text>}
            <text fg={theme.textMuted}>{description}</text>
          </box>
        );
      })}
    </box>
  );
};
