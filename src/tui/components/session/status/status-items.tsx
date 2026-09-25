import type { TodoItem } from '@agent/tools/flow/todo.ts'
import type { PermissionMode } from '@config/harness-options.ts'
import type { SessionStatusItem } from '@config/session-layout.ts'
import { TextAttributes } from '@opentui/core'
import { theme } from '@states/theme-state.ts'
import { TOOLTIP_DEFAULT_MAX_WIDTH } from '@states/tooltip.state.ts'
import { TodoList } from '@tui/components/session/tools/todo-list.tsx'
import { StatusSegment } from '@tui/components/shared/status-segment.tsx'
import { StatusSeparator } from '@tui/components/shared/status-separator.tsx'
import { Tooltip } from '@tui/components/tooltip.tsx'
import { icons } from '@tui/themes/icons.ts'
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { ProviderStatusExtra } from './provider-extras.ts'
import { type ActivityKind, isLoadingAdjacentToAgent, pickLoadingVerb, type SessionStatusData, type SessionStatusProps } from './session-status-data.ts'

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

export interface StatusRenderContext {
  status: SessionStatusProps
  data: SessionStatusData
  providerExtras: () => Array<ProviderStatusExtra>
  onModelOpen?: () => void
  selectable?: boolean
}

const AgentItem = (props: { ctx: StatusRenderContext }) => (
  <text fg={props.ctx.data.agentColor()} flexShrink={0} selectable={false}>
    {`${icons.agent} ${props.ctx.data.agentName()}`}
  </text>
)

const ModelItem = (props: { ctx: StatusRenderContext }) => {
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      flexShrink={1}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        event.stopPropagation()
        props.ctx.onModelOpen?.()
      }}>
      <text fg={theme().text} flexShrink={1} attributes={hovered() ? TextAttributes.UNDERLINE : undefined}>
        {props.ctx.data.modelLabel()}
      </text>
    </box>
  )
}

const EffortItem = (props: { ctx: StatusRenderContext }) => (
  <text fg={props.ctx.data.thinkingColor()} flexShrink={0} selectable={false}>
    {`${icons.thought} ${props.ctx.data.thinkingLabel()}`}
  </text>
)

const RunStateItem = (props: { ctx: StatusRenderContext }) => (
  <text fg={props.ctx.data.finishColor()} flexShrink={0} selectable={false}>
    {`${activityIcon(props.ctx.data.activity())} ${props.ctx.data.finishReason()}`}
  </text>
)

const LoadingItem = (props: { ctx: StatusRenderContext; adjacentToAgent: boolean }) => {
  const verb = createMemo(() => {
    props.ctx.status.statsMetrics?.stepCount
    return pickLoadingVerb()
  })
  return (
    <box flexDirection="row" columnGap={1} flexShrink={0} flexWrap="wrap">
      <Show when={props.adjacentToAgent}>
        <text fg={props.ctx.data.agentColor()}>{`is ${verb()}`}</text>
      </Show>
      <spinner name="point" color={theme().accent} />
    </box>
  )
}

const SessionTitleItem = (props: { ctx: StatusRenderContext }) => (
  <text fg={theme().text} flexShrink={1}>
    {props.ctx.status.title}
  </text>
)

const TodoItemView = (props: { ctx: StatusRenderContext }) => {
  const [hovered, setHovered] = createSignal(false)
  return (
    <Show when={props.ctx.data.todoItems()} keyed>
      {(items: Array<TodoItem>) => (
        <Tooltip content={<TodoList items={items} />} maxWidth={TOOLTIP_DEFAULT_MAX_WIDTH} position="top">
          <box flexShrink={0} onMouseOver={() => setHovered(true)} onMouseOut={() => setHovered(false)}>
            <text fg={theme().accent} flexShrink={0} selectable={false} attributes={hovered() ? TextAttributes.UNDERLINE : undefined}>
              {`Todo: ${items.filter((item) => item.done).length}/${items.length}`}
            </text>
          </box>
        </Tooltip>
      )}
    </Show>
  )
}

const TtftItem = (props: { ctx: StatusRenderContext }) => (
  <StatusSegment icon={'TTFT'} value={props.ctx.data.ttftLabel()} labelColor={theme().primary} valueColor={theme().textMuted} selectable={props.ctx.selectable} />
)

const TpsItem = (props: { ctx: StatusRenderContext }) => (
  <StatusSegment icon={'TPS'} value={props.ctx.data.tpsLabel()} labelColor={theme().primary} valueColor={theme().textMuted} selectable={props.ctx.selectable} />
)

const ToolTimeItem = (props: { ctx: StatusRenderContext }) => (
  <StatusSegment icon={'TT'} value={props.ctx.data.toolExecLabel()} labelColor={theme().primary} valueColor={theme().textMuted} selectable={props.ctx.selectable} />
)

const InputItem = (props: { ctx: StatusRenderContext }) => (
  <StatusSegment icon={icons.arrowUp} value={props.ctx.data.inputLabel()} labelColor={theme().info} valueColor={theme().textMuted} selectable={props.ctx.selectable} />
)

const OutputItem = (props: { ctx: StatusRenderContext }) => (
  <StatusSegment icon={icons.arrowDown} value={props.ctx.data.outputLabel()} labelColor={theme().success} valueColor={theme().textMuted} selectable={props.ctx.selectable} />
)

const CacheItem = (props: { ctx: StatusRenderContext }) => (
  <StatusSegment icon={icons.cache} value={props.ctx.data.cacheSummary()} labelColor={theme().secondary} valueColor={theme().textMuted} selectable={props.ctx.selectable} />
)

const CostItem = (props: { ctx: StatusRenderContext }) => (
  <StatusSegment icon={icons.cost} value={props.ctx.data.costValue()} labelColor={theme().warning} valueColor={theme().textMuted} selectable={props.ctx.selectable} />
)

const permissionModeLabel = (mode: PermissionMode | undefined): string => (mode === 'yolo' ? 'Ya only live once' : mode === 'autopilot' ? 'Picopilot' : 'Picoasks')

const permissionModeColor = (mode: PermissionMode | undefined) => (mode === 'yolo' ? theme().warning : mode === 'autopilot' ? theme().secondary : theme().success)

const PermissionModeItem = (props: { ctx: StatusRenderContext }) => (
  <StatusSegment icon={icons.shield} value={permissionModeLabel(props.ctx.status.permissionMode)} valueColor={permissionModeColor(props.ctx.status.permissionMode)} selectable={props.ctx.selectable} />
)

const MsgsItem = (props: { ctx: StatusRenderContext }) => <StatusSegment icon={icons.fileText} value={`${props.ctx.data.stats().total} msgs`} selectable={props.ctx.selectable} />

const ToolsItem = (props: { ctx: StatusRenderContext }) => <StatusSegment icon={icons.tool} value={`${props.ctx.data.stats().tools} tools`} selectable={props.ctx.selectable} />

const McpItem = (props: { ctx: StatusRenderContext }) => (
  <StatusSegment icon={icons.plug} value={`${props.ctx.status.mcp?.connected}/${props.ctx.status.mcp?.total} mcp · ${props.ctx.status.mcp?.tools} tools`} selectable={props.ctx.selectable} />
)

const QueueItem = (props: { ctx: StatusRenderContext }) => (
  <StatusSegment icon={icons.bell} value={props.ctx.data.queueLabel() as string} valueColor={theme().warning} selectable={props.ctx.selectable} />
)

const JobsItem = (props: { ctx: StatusRenderContext }) => <StatusSegment icon={icons.stop} value={`${props.ctx.status.bgJobs} bg`} valueColor={theme().warning} selectable={props.ctx.selectable} />

const ProviderItemsItem = (props: { ctx: StatusRenderContext }) => (
  <box flexDirection="row" columnGap={1}>
    <For each={props.ctx.providerExtras()}>
      {(extra) => <StatusSegment label={extra.label} labelColor={theme().text} value={extra.value} valueColor={theme().textMuted} selectable={props.ctx.selectable} />}
    </For>
  </box>
)

export const StatusItemView = (props: { item: SessionStatusItem; ctx: StatusRenderContext; previousItem?: SessionStatusItem }) => (
  <box flexDirection="row" flexShrink={0} flexWrap="wrap">
    <Show when={props.item === 'agent'}>
      <AgentItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'model'}>
      <ModelItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'effort' && props.ctx.status.thinking && props.ctx.status.modelKey}>
      <EffortItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'run-state' && props.ctx.data.finishReason()}>
      <RunStateItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'loading' && props.ctx.status.streaming}>
      <LoadingItem ctx={props.ctx} adjacentToAgent={isLoadingAdjacentToAgent(props.previousItem)} />
    </Show>
    <Show when={props.item === 'session-title' && (props.ctx.status.title || props.ctx.status.streaming)}>
      <Show when={props.ctx.status.title}>
        <SessionTitleItem ctx={props.ctx} />
      </Show>
    </Show>
    <Show when={props.item === 'todo'}>
      <TodoItemView ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'ttft'}>
      <TtftItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'tps'}>
      <TpsItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'tool-time'}>
      <ToolTimeItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'input'}>
      <InputItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'output'}>
      <OutputItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'cache'}>
      <CacheItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'cost'}>
      <CostItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'permission-mode'}>
      <PermissionModeItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'msgs'}>
      <MsgsItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'tools'}>
      <ToolsItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'mcp' && props.ctx.status.mcp && props.ctx.status.mcp.total > 0}>
      <McpItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'queue' && props.ctx.data.queueLabel()}>
      <QueueItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'jobs' && (props.ctx.status.bgJobs ?? 0) > 0}>
      <JobsItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'provider-items'}>
      <ProviderItemsItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'separator'}>
      <StatusSeparator sep={icons.middleDot} selectable={props.ctx.selectable} />
    </Show>
  </box>
)

export const statusItemHasContent = (item: SessionStatusItem, ctx: StatusRenderContext): boolean => {
  switch (item) {
    case 'effort':
      return Boolean(ctx.status.thinking && ctx.status.modelKey)
    case 'run-state':
      return ctx.data.finishReason() !== undefined
    case 'loading':
      return Boolean(ctx.status.streaming)
    case 'session-title':
      return Boolean(ctx.status.title || ctx.status.streaming)
    case 'todo':
      return (ctx.data.todoItems()?.length ?? 0) > 0
    case 'mcp':
      return Boolean(ctx.status.mcp && ctx.status.mcp.total > 0)
    case 'queue':
      return ctx.data.queueLabel() !== undefined
    case 'jobs':
      return (ctx.status.bgJobs ?? 0) > 0
    case 'provider-items':
      return ctx.providerExtras().length > 0
    case 'separator':
      return true
    default:
      return true
  }
}
