import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { clip } from '@shared/format.ts'
import { theme } from '@states/theme-state.ts'
import { Diff, filetypeFromPath } from '@tui/components/diff.tsx'
import { toneColor } from '@tui/components/shared/tool-tone.ts'
import { getSharedTreeSitterClientSync } from '@wrappers/treesitter-wrapper.ts'
import { createMemo, createSignal, Show } from 'solid-js'
import 'opentui-spinner/solid'
import type { TodoItem } from '@agent/tools/flow/todo.ts'
import { AskForm } from './ask-form.tsx'
import { FlowStaticView, type ToolFlowResponse } from './flow-view.tsx'
import { PlanReview, type PlanVerdict } from './plan-review.tsx'
import { SpawnView } from './spawn-view.tsx'
import { TodoList } from './todo-list.tsx'
import {
  EXPANDED_MAX_LINES,
  flowOutputMessage,
  flowOutputStatus,
  isSpawnTool,
  type KnowledgeDetail,
  knowledgeDetail,
  planText,
  previewToolInput,
  summarizeToolInput,
  summarizeToolOutput,
  type ToolPartLike,
  toolAskQuestions,
  toolDiff,
  toolDisplayName,
  toolOutputText,
  toolProgress,
  toolStateView,
  truncateLines,
} from './tool-summary.ts'

export type { ToolFlowResponse } from './flow-view.tsx'

export type ToolPartProps = {
  part: ToolPartLike
  partKey: string
  isLastMessage?: boolean
  onFlowResponse?: (response: ToolFlowResponse) => void | Promise<void>
  onOpenSubSession?: (sessionId: string, label: string) => void
}

const [expandedKeys, setExpandedKeys] = createSignal<ReadonlySet<string>>(new Set())
const [collapsedKeys, setCollapsedKeys] = createSignal<ReadonlySet<string>>(new Set())

const isAskTool = (part: ToolPartLike): boolean => part.type === 'tool-ask' || (part.type === 'dynamic-tool' && part.toolName === 'ask')

const isPlanWriteTool = (part: ToolPartLike): boolean => part.type === 'tool-plan-write' || (part.type === 'dynamic-tool' && part.toolName === 'plan-write')

const isTodoTool = (part: ToolPartLike): boolean => part.type === 'tool-todo' || (part.type === 'dynamic-tool' && part.toolName === 'todo')

const isTodoItem = (value: unknown): value is TodoItem =>
  typeof value === 'object' && value !== null && typeof (value as { title?: unknown }).title === 'string' && typeof (value as { done?: unknown }).done === 'boolean'

const todoItems = (part: ToolPartLike): TodoItem[] | undefined => {
  const output = part.output
  if (typeof output === 'object' && output !== null && Array.isArray((output as { items?: unknown }).items)) {
    const items = (output as { items: unknown[] }).items.filter(isTodoItem)
    if (items.length > 0) return items
  }
  const input = part.input
  if (typeof input === 'object' && input !== null) {
    const actionType = (input as { actionType?: unknown }).actionType
    const action = (input as { action?: unknown }).action
    if (actionType === 'ins' && typeof action === 'object' && action !== null && Array.isArray((action as { ins?: unknown }).ins)) {
      const items = (action as { ins: unknown[] }).ins.filter(isTodoItem)
      if (items.length > 0) return items
    }
  }
  return undefined
}

const CODE_PREVIEW_MAX_LINES = 20

const writeContent = (part: ToolPartLike): string | undefined => {
  const output = part.output
  if (typeof output !== 'object' || output === null) return undefined
  const content = (output as { content?: unknown }).content
  if (typeof content !== 'string' || content.length === 0) return undefined
  const lines = content.split('\n')
  if (lines.length <= CODE_PREVIEW_MAX_LINES) return content
  return `${lines.slice(0, CODE_PREVIEW_MAX_LINES).join('\n')}\n…`
}

const writePath = (part: ToolPartLike): string => {
  const input = part.input
  if (typeof input !== 'object' || input === null) return ''
  const path = (input as { path?: unknown }).path
  return typeof path === 'string' ? path : ''
}

export const ToolPart = (props: ToolPartProps) => {
  if (isSpawnTool(props.part)) {
    return <SpawnView part={props.part} onOpen={props.onOpenSubSession} />
  }
  if (isAskTool(props.part)) {
    return <FlowStaticView part={props.part} isLastMessage={props.isLastMessage} flowKind="ask" onFlowResponse={props.onFlowResponse} />
  }
  if (isPlanWriteTool(props.part)) {
    return <FlowStaticView part={props.part} isLastMessage={props.isLastMessage} flowKind="plan-write" onFlowResponse={props.onFlowResponse} />
  }
  const [hovered, setHovered] = createSignal(false)
  const name = createMemo(() => toolDisplayName(props.part))
  const view = createMemo(() => toolStateView(props.part))
  const color = createMemo(() => toneColor(view().tone))
  const summary = createMemo(() => {
    const known = summarizeToolInput(name(), props.part.input)
    return known === '?' ? previewToolInput(props.part.input) : known
  })
  const runningProgress = createMemo(() => toolProgress(props.part))
  const knowledge = createMemo(() => knowledgeDetail(props.part))
  const outputPreview = createMemo(() => (runningProgress() ? undefined : summarizeToolOutput(name(), props.part.output, props.part.errorText)))
  const diff = createMemo(() => (props.part.state === 'output-available' ? toolDiff(props.part.output) : undefined))
  const written = createMemo(() => (knowledge() !== undefined ? undefined : props.part.state === 'output-available' ? writeContent(props.part) : undefined))
  const expandedText = createMemo(() => {
    if (runningProgress() || written() !== undefined || knowledge() !== undefined || diff() !== undefined) return undefined
    if (props.part.state !== 'output-available' && props.part.state !== 'output-error') return undefined
    const raw = toolOutputText(name(), props.part.output)
    if (raw === undefined) return undefined
    if (raw.trim().length === 0) return 'No matches'
    return truncateLines(raw, EXPANDED_MAX_LINES).text
  })
  const questions = createMemo(() => (isAskTool(props.part) ? toolAskQuestions(props.part.input) : []))
  const plan = createMemo(() => (isPlanWriteTool(props.part) ? planText(props.part.input) : undefined))
  const flowStatus = createMemo(() => (isAskTool(props.part) || isPlanWriteTool(props.part) ? flowOutputStatus(props.part) : undefined))
  const flowMessage = createMemo(() => (isAskTool(props.part) || isPlanWriteTool(props.part) ? flowOutputMessage(props.part) : ''))
  const flowInteractive = () => props.isLastMessage === true && flowStatus() === 'pending'
  const hasToolCallId = () => (props.part.toolCallId ?? '').length > 0
  const showAsk = () => hasToolCallId() && questions().length > 0 && flowStatus() !== undefined
  const showPlan = () => hasToolCallId() && plan() !== undefined && flowStatus() !== undefined
  const pendingWithoutId = () => !hasToolCallId() && (questions().length > 0 || plan() !== undefined) && flowStatus() !== undefined
  const pendingFlow = () => flowInteractive() && (questions().length > 0 || plan() !== undefined)
  const todos = createMemo(() => (isTodoTool(props.part) ? todoItems(props.part) : undefined))

  const dims = useTerminalDimensions()
  const isAutoExpanded = () => todos() !== undefined || pendingFlow()
  const expanded = (): boolean => (isAutoExpanded() ? !collapsedKeys().has(props.partKey) : expandedKeys().has(props.partKey))
  const toggle = () => {
    const key = props.partKey
    if (isAutoExpanded()) {
      setCollapsedKeys((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else {
          next.add(key)
          while (next.size > 200) {
            const oldest = next.values().next().value
            if (oldest === undefined) break
            next.delete(oldest)
          }
        }
        return next
      })
      return
    }
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else {
        next.add(key)
        while (next.size > 200) {
          const oldest = next.values().next().value
          if (oldest === undefined) break
          next.delete(oldest)
        }
      }
      return next
    })
  }

  const collapsedLine = createMemo(() => {
    const detail = [summary(), runningProgress() ?? outputPreview()].filter((part) => typeof part === 'string' && part.length > 0).join(' · ')
    return `${name()} ${detail}`
  })
  const clipToWidth = (line: string): string => {
    const max = Math.max(8, dims().width - 6 - view().icon.length)
    return clip(line, max)
  }

  const toolCallId = () => props.part.toolCallId ?? ''

  return (
    <box flexDirection="column" paddingLeft={1} border={['left']} bottomTitle={` ${name()} `} bottomTitleAlignment="right" borderStyle={'heavy'} borderColor={color()}>
      <Show
        when={expanded()}
        fallback={
          <box
            flexDirection="row"
            gap={1}
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
            onMouseUp={(event) => {
              event.stopPropagation()
              toggle()
            }}>
            <text fg={color()} selectable={false}>
              {view().icon}
            </text>
            <text fg={hovered() ? theme().accent : theme().textMuted} attributes={hovered() ? TextAttributes.BOLD : undefined} selectable={false}>
              {clipToWidth(collapsedLine())}
            </text>
          </box>
        }>
        <box
          flexDirection="row"
          gap={1}
          flexWrap="wrap"
          onMouseOver={() => setHovered(true)}
          onMouseOut={() => setHovered(false)}
          onMouseUp={(event) => {
            event.stopPropagation()
            toggle()
          }}>
          <text fg={color()} selectable={false}>
            {view().icon}
          </text>
          <text fg={color()} flexShrink={0} attributes={hovered() ? TextAttributes.BOLD : undefined}>
            {name()}
          </text>
          <text fg={theme().textMuted} flexShrink={1} attributes={hovered() ? TextAttributes.BOLD : undefined}>
            {summary()}
          </text>
        </box>
        <Show when={runningProgress()} keyed>
          {(progress: string) => <text fg={color()}>{progress}</text>}
        </Show>
        <Show when={written()} keyed>
          {(content: string) => <code content={content} filetype={filetypeFromPath(writePath(props.part))} syntaxStyle={theme().syntax} treeSitterClient={getSharedTreeSitterClientSync()} conceal />}
        </Show>
        <Show when={todos()} keyed>
          {(items: TodoItem[]) => (
            <box maxHeight={EXPANDED_MAX_LINES} overflow="hidden">
              <TodoList items={items} />
            </box>
          )}
        </Show>
        <Show when={knowledge()} keyed>
          {(detail: KnowledgeDetail) => (
            <box flexDirection="column" gap={0}>
              <Show when={detail.description.length > 0}>
                <text fg={theme().text}>{detail.description}</text>
              </Show>
              <Show when={detail.file.length > 0}>
                <text fg={theme().textMuted}>
                  {detail.file}
                  {detail.relatedFiles > 0 ? ` · ${detail.relatedFiles} related files` : ''}
                </text>
              </Show>
            </box>
          )}
        </Show>
        <Show when={diff()} keyed>
          {(diff: string) => <Diff diff={diff} maxHeight={EXPANDED_MAX_LINES} />}
        </Show>
        <Show when={expandedText()} keyed>
          {(body: string) => (
            <box maxHeight={EXPANDED_MAX_LINES} overflow="hidden" flexDirection="column">
              <text fg={theme().text}>{body}</text>
            </box>
          )}
        </Show>
        <Show when={outputPreview() && todos() === undefined && knowledge() === undefined} keyed>
          {(preview: string) => <text fg={theme().textMuted}>{preview}</text>}
        </Show>
      </Show>
      <Show when={showAsk()}>
        <AskForm
          questions={questions()}
          status={flowStatus()}
          outputMessage={flowMessage()}
          interactive={flowInteractive()}
          onConfirm={(text) => props.onFlowResponse?.({ tool: 'ask', toolCallId: toolCallId(), output: { status: 'answered', message: text } })}
          onCancel={() =>
            props.onFlowResponse?.({
              tool: 'ask',
              toolCallId: toolCallId(),
              output: { status: 'cancelled', message: 'The user dismissed the questions without answering' },
            })
          }
        />
      </Show>
      <Show when={showPlan()}>
        <PlanReview
          plan={plan() ?? ''}
          status={flowStatus()}
          outputMessage={flowMessage()}
          interactive={flowInteractive()}
          onVerdict={(status: PlanVerdict, message: string, compact: boolean) => props.onFlowResponse?.({ tool: 'plan-write', toolCallId: toolCallId(), output: { status, message }, compact })}
          onCancel={() => props.onFlowResponse?.({ tool: 'plan-write', toolCallId: toolCallId(), output: { status: 'cancelled', message: 'The user dismissed the plan review' } })}
        />
      </Show>
      <Show when={pendingWithoutId()}>
        <text fg={theme().textMuted}>Preparing input…</text>
      </Show>
    </box>
  )
}
