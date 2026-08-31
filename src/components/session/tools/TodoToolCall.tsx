import { useSelector } from "@xstate/store-react";
import { TextAttributes } from "@opentui/core";
import { themeStore } from "../../../stores/theme-store";
import { ToolCallShell } from "../ToolCallShell";
import type { ToolStatus } from "../ToolCall";

export type TodoItem = {
  phase: string;
  title: string;
  prompt: string;
  done: boolean;
};

export type TodoToolCallProps = {
  status: ToolStatus;
  items: TodoItem[];
  error?: string;
};

/**
 * Todo tool renderer: unlike the filesystem tools (which show diffs/output),
 * the todo list is rendered as a tree grouped by phase:
 *
 *   Phase name
 *   ├─ [x] Done Todo Title
 *   └─ [ ] Not Done Todo Title
 */
export const TodoToolCall = ({ status, items, error, copyText }: TodoToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  // Group by phase, preserving first-seen order.
  const phases: { phase: string; items: TodoItem[] }[] = [];
  for (const item of items) {
    const last = phases[phases.length - 1];
    if (last && last.phase === item.phase) last.items.push(item);
    else phases.push({ phase: item.phase, items: [item] });
  }

  const doneCount = items.filter((i) => i.done).length;
  // An empty list (0/0) is pinned open and not toggleable; with items the body
  // starts open but can still be collapsed by clicking the header.
  const collapsible = items.length > 0;

  return (
    <ToolCallShell
      name="Todo"
      status={status}
      error={error}
      copyText={copyText}
      // The todo list is the session's live plan: keep it visible at all times.
      defaultCollapsed={false}
      collapsible={collapsible}
      header={(hovered) => (
        <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>
          {`${doneCount}/${items.length} done`}
        </text>
      )}
    >
      <box flexDirection="column">
        {!collapsible && (
          <text selectable={false} fg={theme.textMuted}>
            No todos yet
          </text>
        )}
        {phases.map(({ phase, items: phaseItems }, phaseIndex) => (
          <box key={`${phase}-${phaseIndex}`} flexDirection="column">
            <text selectable={false} fg={theme.text} attributes={TextAttributes.BOLD}>
              {phase}
            </text>
            {phaseItems.map((item, itemIndex) => {
              const branch = itemIndex === phaseItems.length - 1 ? "└─" : "├─";
              const check = item.done ? "[x]" : "[ ]";
              return (
                <text
                  key={`${item.title}-${itemIndex}`}
                  selectable={false}
                  fg={item.done ? theme.success : theme.textMuted}
                >
                  {`${branch} ${check} ${item.title}`}
                </text>
              );
            })}
          </box>
        ))}
      </box>
    </ToolCallShell>
  );
};
