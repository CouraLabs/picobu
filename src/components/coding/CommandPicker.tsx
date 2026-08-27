import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";
import { loopStore } from "../../stores/loop-store";
import { filterCommands } from "../../harness/commands";
import type { CommandKind } from "../../harness/commands";

const BADGE: Record<CommandKind, string> = {
  system: "SYSTEM",
  workflow: "WORKFLOW",
  skill: "SKILL"
};

/**
 * Filterable slash-command autocomplete. Presentational only: it does not trap
 * focus, so the prompt textarea keeps typing/filter focus. Reading directly
 * from loopStore re-renders as `commandQuery` changes.
 */
export const CommandPicker = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const { commandOpen, commandQuery, commandSelected } = useSelector(
    loopStore,
    (s) => s.context,
  );

  if (!commandOpen) return null;
  const items = filterCommands(commandQuery);
  if (items.length === 0) return null;

  return (
    <box
      border
      borderStyle="single"
      title=" Commands "
      titleColor={theme.accent}
      borderColor={theme.accent}
      maxHeight={8}
      paddingX={1}
      flexDirection="column"
    >
      {items.map((item, i) => (
        <box key={`${item.kind}:${item.name}`} flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>{BADGE[item.kind]}</text>
          <text fg={i === commandSelected ? theme.selectedListItemText : theme.text}>
            /{item.name}
          </text>
          {item.aliases.length > 0 && (
            <text fg={theme.textMuted}>({item.aliases.join(", ")})</text>
          )}
          <text fg={theme.textMuted}>{item.description}</text>
        </box>
      ))}
    </box>
  );
};