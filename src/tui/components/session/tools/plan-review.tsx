import type { InputRenderable, TextareaRenderable } from '@opentui/core'
import { clip } from '@shared/format.ts'
import { theme } from '@states/theme-state.ts'
import { Button } from '@tui/components/button.tsx'
import { icons } from '@tui/themes/icons.ts'
import { createSignal, For, Show } from 'solid-js'

export type PlanVerdict = 'approved' | 'rejected'

export interface PlanReviewProps {
  plan: string
  status?: string
  outputMessage?: string
  interactive: boolean
  onVerdict: (status: PlanVerdict, message: string) => void | Promise<void>
  onCancel: () => void | Promise<void>
}

export const PlanReview = (props: PlanReviewProps) => {
  const lines = () => props.plan.split('\n').filter((l) => l.trim().length > 0)
  const [lineComments, setLineComments] = createSignal<Array<string>>(lines().map(() => ''))
  const [openLine, setOpenLine] = createSignal<number | undefined>(undefined)
  const [overall, setOverall] = createSignal('')
  const [responded, setResponded] = createSignal(false)
  const [dismissed, setDismissed] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  const lineRefs: Array<InputRenderable | null> = []
  let overallRef: TextareaRenderable | null = null

  const readonly = () => !props.interactive || sending() || responded() || (props.status !== undefined && props.status !== 'pending')
  const wasDismissed = () => props.status === 'cancelled' || (responded() && dismissed() && props.status !== 'approved' && props.status !== 'rejected')

  const setLineComment = (index: number, value: string) => {
    if (readonly()) return
    setLineComments((prev) => {
      const next = [...prev]
      while (next.length < lines().length) next.push('')
      next[index] = value
      return next
    })
  }

  const hasComment = () => lineComments().some((c) => c.trim().length > 0) || overall().trim().length > 0

  const buildMessage = (): string => {
    const parts: Array<string> = []
    lines().forEach((line, index) => {
      const comment = (lineComments()[index] ?? '').trim()
      if (comment) parts.push(`Line ${index + 1} "${clip(line.trim(), 80)}": ${comment}`)
    })
    const all = overall().trim()
    if (all) parts.push(`Overall: ${all}`)
    return parts.join('\n')
  }

  const verdict = async (status: PlanVerdict) => {
    if (readonly()) return
    if (status === 'rejected' && !hasComment()) return
    const message = buildMessage()
    setSending(true)
    try {
      await props.onVerdict(status, message.length > 0 ? message : 'Approved')
      setDismissed(false)
      setResponded(true)
    } catch {
    } finally {
      setSending(false)
    }
  }

  const cancel = async () => {
    if (readonly()) return
    setSending(true)
    try {
      await props.onCancel()
      setDismissed(true)
      setResponded(true)
    } catch {
    } finally {
      setSending(false)
    }
  }

  return (
    <box flexDirection="column" paddingLeft={1} border={['right']} borderStyle={'heavy'} borderColor={theme().borderSubtle}>
      <Show
        when={!readonly()}
        fallback={
          <box flexDirection="column" gap={1}>
            <Show
              when={wasDismissed()}
              fallback={
                <Show
                  when={props.status !== undefined && props.status !== 'pending' && props.outputMessage}
                  fallback={
                    <For each={lines()}>
                      {(line, index) => (
                        <box flexDirection="column">
                          <markdown syntaxStyle={theme().syntax} conceal content={`*${index() + 1}* ${line.trim()}`} />
                          <Show when={(lineComments()[index()] ?? '').trim()} keyed>
                            {(comment: string) => <text fg={theme().accent}>{`  ${icons.flag} ${comment}`}</text>}
                          </Show>
                        </box>
                      )}
                    </For>
                  }>
                  <box flexDirection="column">
                    <text fg={props.status === 'rejected' ? theme().error : theme().success}>{props.status === 'rejected' ? `${icons.cross} Rejected` : `${icons.success} Approved`}</text>
                    <For each={(props.outputMessage ?? '').split('\n')}>{(line) => <text fg={theme().textMuted}>{line}</text>}</For>
                  </box>
                </Show>
              }>
              <text fg={theme().warning}>{`${icons.cross} Review dismissed.`}</text>
            </Show>
          </box>
        }>
        <text fg={theme().textMuted} selectable={false}>
          {`${icons.pencil} Click the pencil icon next to a line to comment on it`}
        </text>
        <For each={lines()}>
          {(line, index) => {
            const commented = () => (lineComments()[index()] ?? '').trim().length > 0
            return (
              <box flexDirection="column">
                <box flexDirection="row" gap={1} onMouseUp={() => setOpenLine(openLine() === index() ? undefined : index())}>
                  <box flexDirection="row" gap={1} flexShrink={0} border={commented() ? ['left'] : false} borderStyle={'heavy'} borderColor={commented() ? theme().accent : undefined}>
                    <text fg={commented() ? theme().accent : theme().primary} selectable={false}>
                      {commented() ? icons.flag : icons.pencil}
                    </text>
                  </box>
                  <box flexShrink={1} minWidth={0}>
                    <markdown syntaxStyle={theme().syntax} conceal content={line.trim()} />
                  </box>
                </box>
                <Show when={commented()}>
                  <text fg={theme().accent}>{`  ${icons.edit} ${(lineComments()[index()] ?? '').trim()}`}</text>
                </Show>
                <Show when={openLine() === index()}>
                  <box marginTop={0} marginLeft={4} onMouseUp={() => lineRefs[index()]?.focus()}>
                    <input
                      ref={(r) => {
                        lineRefs[index()] = r
                      }}
                      value={lineComments()[index()] ?? ''}
                      placeholder={`Comment on line ${index() + 1} (optional, clear to remove)`}
                      placeholderColor={theme().textMuted}
                      textColor={theme().text}
                      cursorColor={theme().accent}
                      backgroundColor={theme().backgroundElement}
                      onInput={(value) => setLineComment(index(), value)}
                    />
                  </box>
                </Show>
              </box>
            )
          }}
        </For>
        <box marginTop={1} flexGrow={1} onMouseUp={() => overallRef?.focus()}>
          <textarea
            ref={(r) => {
              overallRef = r
            }}
            placeholder="Overall comment (optional, required to request changes)"
            placeholderColor={theme().textMuted}
            textColor={theme().text}
            cursorColor={theme().accent}
            backgroundColor={theme().backgroundElement}
            maxHeight={4}
            onContentChange={() => {
              if (!readonly()) setOverall(overallRef?.plainText ?? '')
            }}
          />
        </box>
        <box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
          <Button label={`${icons.success} Approve`} isActive onClick={() => verdict('approved')} />
          <Show when={hasComment()}>
            <Button label={`${icons.edit} Request changes`} onClick={() => verdict('rejected')} />
          </Show>
          <Button label={`${icons.cross} Dismiss`} onClick={cancel} />
        </box>
      </Show>
    </box>
  )
}
