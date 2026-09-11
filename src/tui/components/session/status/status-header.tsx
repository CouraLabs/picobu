import type { TodoItem } from '@agent/tools/flow/todo.ts'
import { theme } from '@states/theme-state.ts'
import { TOOLTIP_DEFAULT_MAX_WIDTH } from '@states/tooltip.state.ts'
import { TodoList } from '@tui/components/session/tools/todo-list.tsx'
import { StatusSeparator } from '@tui/components/shared/status-separator.tsx'
import { Tooltip } from '@tui/components/tooltip.tsx'
import { icons } from '@tui/themes/icons.ts'
import { Show } from 'solid-js'
import type { ActivityKind, SessionStatusData, SessionStatusProps } from './session-status-data.ts'

const activityIcon = (activity: ActivityKind | undefined): string => {
  switch (activity) {
    case 'prompting':
      return icons.clock
    case 'reasoning':
      return icons.thought
    case 'tooling':
      return icons.tool
    case 'delegating':
      return icons.agent
    case 'answering':
      return icons.pencil
    default:
      return icons.flag
  }
}

export const StatusHeader = (props: { status: SessionStatusProps; data: SessionStatusData }) => (
  <box flexDirection="row" columnGap={1} justifyContent="space-between" flexShrink={0} flexWrap="wrap">
    <box flexDirection="row" columnGap={1} flexShrink={1} minWidth={0} flexWrap="wrap">
      <text fg={props.data.agentColor()} flexShrink={0}>
        {`${icons.agent} ${props.data.agentName()}`}
      </text>
      <StatusSeparator sep={icons.middleDot} />
      <text fg={theme().text} flexShrink={1}>
        {props.data.modelLabel()}
      </text>
      <Show when={props.status.thinking && props.status.modelKey}>
        <StatusSeparator sep={icons.middleDot} />
        <text fg={props.data.thinkingColor()} flexShrink={0}>
          {`${icons.thought} ${props.data.thinkingLabel()}`}
        </text>
      </Show>
      <Show when={props.data.finishReason()}>
        <StatusSeparator sep={icons.middleDot} />
        <text fg={props.data.finishColor()} flexShrink={0}>
          {`${activityIcon(props.data.activity())} ${props.data.finishReason()}`}
        </text>
      </Show>
      <Show when={props.status.title || props.status.streaming}>
        <StatusSeparator sep={icons.middleDot} />
        <Show when={props.status.streaming}>
          <spinner name="dotsCircle" color={theme().accent} />
        </Show>
        <Show when={props.status.title}>
          <text fg={theme().text} flexShrink={1}>
            {props.status.title}
          </text>
        </Show>
      </Show>
      <Show when={props.data.todoItems()} keyed>
        {(items: Array<TodoItem>) => (
          <box flexDirection="row" flexShrink={0} columnGap={1}>
            <StatusSeparator sep={icons.middleDot} />
            <Tooltip content={<TodoList items={items} />} maxWidth={TOOLTIP_DEFAULT_MAX_WIDTH} position="top">
              <text fg={theme().accent} flexShrink={0}>
                {`Todo: ${items.filter((item) => item.done).length}/${items.length}`}
              </text>
            </Tooltip>
          </box>
        )}
      </Show>
    </box>
  </box>
)
