import type { TodoItem } from "@agent/tools/flow/todo.ts";
import { TextAttributes } from "@opentui/core";
import { theme } from "@states/theme-state.ts";
import { icons } from "@tui/themes/icons.ts";
import { For, Show } from "solid-js";

export type TodoListProps = {
  items: TodoItem[];
};

const PROGRESS_WIDTH = 10;

export const TodoList = (props: TodoListProps) => {
  const doneCount = () => props.items.filter((item) => item.done).length;
  const filled = () => (props.items.length > 0 ? Math.round((doneCount() / props.items.length) * PROGRESS_WIDTH) : 0);

  const isCurrent = (index: number): boolean => {
    const item = props.items[index];
    return item !== undefined && !item.done && props.items.slice(0, index).every((i) => i.done);
  };

  return (
    <box flexDirection="column" paddingLeft={1}>
      <box flexDirection="row" gap={1}>
        <text fg={theme().primary} selectable={false}>
          {icons.progressFull.repeat(filled())}
          {icons.progressEmpty.repeat(PROGRESS_WIDTH - filled())}
        </text>
        <text fg={theme().textMuted}>
          {doneCount()}/{props.items.length}
        </text>
      </box>
      <For each={props.items}>
        {(item, index) => (
          <box flexDirection="column">
            <Show when={index() === 0 || props.items[index() - 1]?.phase !== item.phase}>
              <text fg={theme().textMuted}>{item.phase}</text>
            </Show>
            <box flexDirection="row" gap={1}>
              <text fg={item.done ? theme().success : isCurrent(index()) ? theme().primary : theme().textMuted} selectable={false} flexShrink={0}>
                {item.done ? icons.success : isCurrent(index()) ? icons.running : icons.pending}
              </text>
              <text fg={item.done ? theme().textMuted : theme().text} attributes={isCurrent(index()) ? TextAttributes.BOLD : undefined} overflow="hidden" flexShrink={1}>
                {item.title}
              </text>
            </box>
          </box>
        )}
      </For>
    </box>
  );
};
