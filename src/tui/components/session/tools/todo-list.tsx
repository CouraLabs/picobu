import type { TodoItem } from '@agent/tools/flow/todo.ts'
import { TextAttributes } from '@opentui/core'
import { theme } from '@states/theme-state.ts'
import { icons } from '@tui/themes/icons.ts'
import { For } from 'solid-js'

export interface TodoListProps {
  items: Array<TodoItem>
}

export const TodoList = (props: TodoListProps) => {
  const isCurrent = (index: number): boolean => {
    const item = props.items[index]
    return item !== undefined && !item.done && props.items.slice(0, index).every((i) => i.done)
  }

  return (
    <box flexDirection="column" width="100%">
      <For each={props.items}>
        {(item, index) => (
          <box flexDirection="row" gap={1} width="100%">
            <text fg={item.done ? theme().success : isCurrent(index()) ? theme().primary : theme().textMuted} selectable={false} flexShrink={0}>
              {item.done ? `[${icons.success}]` : '[ ]'}
            </text>
            <text fg={item.done ? theme().textMuted : theme().text} attributes={isCurrent(index()) ? TextAttributes.BOLD : undefined} overflow="hidden" flexGrow={1}>
              {item.title}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}
