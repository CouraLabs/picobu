import { theme } from '@states/theme-state.ts'
import { toneColor } from '@tui/components/shared/tool-tone.ts'
import { createMemo, Show } from 'solid-js'
import { AskForm } from './ask-form.tsx'
import { PlanReview, type PlanVerdict } from './plan-review.tsx'
import { flowOutputMessage, flowOutputStatus, planText, previewToolInput, summarizeToolInput, type ToolPartLike, toolAskQuestions, toolDisplayName, toolStateView } from './tool-summary.ts'

export type FlowViewProps = {
  part: ToolPartLike
  isLastMessage?: boolean
  flowKind: 'ask' | 'plan-write'
  onFlowResponse?: (response: ToolFlowResponse) => void | Promise<void>
}

export type ToolFlowResponse = {
  tool: 'ask' | 'plan-write'
  toolCallId: string
  output: { status: string; message: string }
}

export const FlowStaticView = (props: FlowViewProps) => {
  const name = createMemo(() => toolDisplayName(props.part))
  const view = createMemo(() => toolStateView(props.part))
  const color = createMemo(() => toneColor(view().tone))
  const summary = createMemo(() => {
    const known = summarizeToolInput(name(), props.part.input)
    return known === '?' ? previewToolInput(props.part.input) : known
  })
  const status = createMemo(() => flowOutputStatus(props.part))
  const message = createMemo(() => flowOutputMessage(props.part))
  const questions = createMemo(() => (props.flowKind === 'ask' ? toolAskQuestions(props.part.input) : []))
  const plan = createMemo(() => (props.flowKind === 'plan-write' ? planText(props.part.input) : undefined))
  const interactive = () => props.isLastMessage === true && status() === 'pending'
  const toolCallId = () => props.part.toolCallId ?? ''
  const hasToolCallId = () => toolCallId().length > 0
  const showAsk = () => props.flowKind === 'ask' && hasToolCallId() && questions().length > 0 && status() !== undefined
  const showPlan = () => props.flowKind === 'plan-write' && hasToolCallId() && plan() !== undefined && status() !== undefined
  const pendingWithoutId = () => !hasToolCallId() && (questions().length > 0 || plan() !== undefined) && status() !== undefined
  return (
    <box flexDirection="column" paddingLeft={1} border={['left']} bottomTitle={` ${name()} `} bottomTitleAlignment="right" borderStyle={'heavy'} borderColor={color()}>
      <box flexDirection="row" gap={1} flexWrap="wrap">
        <box flexShrink={0}>
          <text fg={color()} selectable={false}>
            {view().icon}
          </text>
        </box>
        <text fg={color()} flexShrink={0}>
          {name()}
        </text>
        <text fg={theme().textMuted} flexShrink={1}>
          {summary()}
        </text>
      </box>
      <Show when={status() && !showAsk() && !showPlan()} keyed>
        {(current: string) => (
          <text fg={theme().textMuted}>
            {current}
            {message() ? ` · ${message()}` : ''}
          </text>
        )}
      </Show>
      <Show when={showAsk()}>
        <AskForm
          questions={questions()}
          status={status()}
          outputMessage={message()}
          interactive={interactive()}
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
          status={status()}
          outputMessage={message()}
          interactive={interactive()}
          onVerdict={(verdict: PlanVerdict, verdictMessage: string) => props.onFlowResponse?.({ tool: 'plan-write', toolCallId: toolCallId(), output: { status: verdict, message: verdictMessage } })}
          onCancel={() => props.onFlowResponse?.({ tool: 'plan-write', toolCallId: toolCallId(), output: { status: 'cancelled', message: 'The user dismissed the plan review' } })}
        />
      </Show>
      <Show when={pendingWithoutId()}>
        <text fg={theme().textMuted}>Preparing input…</text>
      </Show>
    </box>
  )
}
