import type { InputRenderable } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { clip } from '@shared/format.ts'
import { theme } from '@states/theme-state.ts'
import { Button } from '@tui/components/button.tsx'
import { icons } from '@tui/themes/icons.ts'
import { createEffect, createSignal, For, Show } from 'solid-js'
import type { AskQuestionView } from './tool-summary.ts'

export type AskFormProps = {
  questions: AskQuestionView[]
  status?: string
  outputMessage?: string
  interactive: boolean
  onConfirm: (answersText: string) => void | Promise<void>
  onCancel: () => void | Promise<void>
}

const TAB_MAX_WIDTH = 24
const COMMENT_MAX_WIDTH = 48

export const AskForm = (props: AskFormProps) => {
  const [active, setActive] = createSignal(0)
  const [answers, setAnswers] = createSignal<string[][]>(props.questions.map(() => []))
  const [hovered, setHovered] = createSignal<{ index: number; answer: string }>({ index: -1, answer: '' })
  const [comments, setComments] = createSignal<string[]>(props.questions.map(() => ''))
  const [responded, setResponded] = createSignal(false)
  const [dismissed, setDismissed] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  const inputRefs: (InputRenderable | null)[] = []

  let prevQuestionsKey = JSON.stringify(props.questions)
  createEffect(() => {
    const key = JSON.stringify(props.questions)
    if (key === prevQuestionsKey) return
    prevQuestionsKey = key
    setAnswers(props.questions.map(() => []))
    setComments(props.questions.map(() => ''))
    setActive(0)
  })

  const summaryIndex = () => props.questions.length
  const isLastTab = () => active() >= summaryIndex()
  const readonly = () => !props.interactive || sending() || responded() || (props.status !== undefined && props.status !== 'pending')
  const wasDismissed = () => props.status === 'cancelled' || (responded() && dismissed() && props.status !== 'answered')
  const isFailureStatus = () => {
    const s = props.status ?? ''
    return s.includes('error') || s.includes('denied')
  }
  const settledTerminal = () => props.status !== undefined && props.status !== 'pending' && props.status !== 'cancelled' && !isFailureStatus()
  const settledFailure = () => props.status !== undefined && props.status !== 'pending' && props.status !== 'cancelled' && isFailureStatus()
  const echoed = () => (settledTerminal() || settledFailure()) && !!props.outputMessage

  const toggle = (questionIndex: number, answer: string) => {
    if (readonly()) return
    const current = answers()[questionIndex] ?? []
    if (current.includes(answer)) {
      setAnswers((prev) => prev.map((selected, index) => (index !== questionIndex ? selected : selected.filter((a) => a !== answer))))
      return
    }
    const next = props.questions[questionIndex]?.type === 'single' ? [answer] : [...current, answer]
    setAnswers((prev) => prev.map((selected, index) => (index !== questionIndex ? selected : next)))
    if (props.questions[questionIndex]?.type === 'single' && next.length > 0) {
      setActive(Math.min(questionIndex + 1, summaryIndex()))
    }
  }

  const hover = (questionIndex: number, answer: string, isHovering: boolean) => {
    if (readonly()) return
    if (isHovering) setHovered({ index: questionIndex, answer })
    else setHovered({ index: -1, answer: '' })
  }

  const setComment = (questionIndex: number, value: string) => {
    if (readonly()) return
    setComments((prev) => prev.map((comment, index) => (index === questionIndex ? value : comment)))
  }

  const allAnswered = () => props.questions.every((_, index) => (answers()[index] ?? []).length > 0)

  const buildAnswersText = (): string =>
    props.questions
      .map((question, index) => {
        const selected = (answers()[index] ?? []).join(', ') || '(no answer)'
        const comment = comments()[index]?.trim()
        return comment ? `${question.title}: ${selected} — ${comment}` : `${question.title}: ${selected}`
      })
      .join('\n')

  const confirm = async () => {
    if (readonly()) return
    setSending(true)
    try {
      await props.onConfirm(buildAnswersText())
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

  const tabBackground = (tabIndex: number) => (active() === tabIndex ? theme().primary : theme().backgroundElement)
  const tabColor = (tabIndex: number) => (active() === tabIndex ? theme().selected(tabBackground(tabIndex)) : theme().textMuted)
  const dims = useTerminalDimensions()
  const commentWidth = () => Math.max(16, Math.min(COMMENT_MAX_WIDTH + 2, dims().width - 10))

  return (
    <box flexDirection="column">
      <Show
        when={!readonly()}
        fallback={
          <box flexDirection="column" gap={1}>
            <Show
              when={wasDismissed()}
              fallback={
                <Show
                  when={echoed()}
                  fallback={
                    <Show
                      when={responded() || settledTerminal() || settledFailure()}
                      fallback={
                        <Show when={settledFailure()} fallback={<text fg={theme().textMuted}>{`${icons.question} Awaiting your answers.`}</text>}>
                          <text fg={theme().error}>{`${icons.cross} Request failed (${props.status}).`}</text>
                        </Show>
                      }>
                      <For each={props.questions}>
                        {(question, index) => {
                          const comment = comments()[index()]?.trim()
                          const line = `${icons.success} ${clip(question.title, TAB_MAX_WIDTH)}: ${(answers()[index()] ?? []).join(', ') || '(no answer)'}${comment ? ` · ${comment}` : ''}`
                          return (
                            <box flexDirection="column">
                              <text fg={theme().textMuted}>{line}</text>
                            </box>
                          )
                        }}
                      </For>
                    </Show>
                  }>
                  <For each={(props.outputMessage ?? '').split('\n')}>
                    {(line) => <text fg={isFailureStatus() ? theme().error : theme().textMuted}>{`${isFailureStatus() ? icons.cross : icons.success} ${line}`}</text>}
                  </For>
                </Show>
              }>
              <text fg={theme().warning}>{`${icons.cross} Dismissed without answering.`}</text>
            </Show>
            <Show when={wasDismissed() || responded() || settledTerminal() || settledFailure()} fallback={<text fg={theme().textMuted}>Awaiting answers.</text>}>
              <Show when={settledFailure()} fallback={<text fg={theme().success}>{wasDismissed() ? 'Dismissed.' : 'Answers sent.'}</text>}>
                <text fg={theme().error}>{`${icons.cross} Failed (${props.status}).`}</text>
              </Show>
            </Show>
          </box>
        }>
        <box flexDirection="row" gap={1} flexWrap="wrap">
          <For each={props.questions}>
            {(question, index) => (
              <box height={1} paddingX={1} flexShrink={0} backgroundColor={tabBackground(index())} onMouseUp={() => setActive(index())}>
                <text fg={tabColor(index())}>{clip(question.title, TAB_MAX_WIDTH)}</text>
              </box>
            )}
          </For>
          <box height={1} paddingX={1} flexShrink={0} backgroundColor={tabBackground(summaryIndex())} onMouseUp={() => setActive(summaryIndex())}>
            <text fg={tabColor(summaryIndex())}>{icons.success} Summary</text>
          </box>
        </box>
        <For each={props.questions}>
          {(question, questionIndex) => (
            <Show when={active() === questionIndex()}>
              <box flexDirection="column" marginTop={1}>
                <Show when={question.question.length > 0}>
                  <text fg={theme().text}>{question.question}</text>
                </Show>
                <For each={question.options}>
                  {(option) => {
                    const checked = () => (answers()[questionIndex()] ?? []).includes(option.answer)
                    return (
                      <box
                        flexDirection="row"
                        gap={1}
                        onMouseUp={() => toggle(questionIndex(), option.answer)}
                        onMouseOver={() => hover(questionIndex(), option.answer, true)}
                        onMouseOut={() => hover(questionIndex(), option.answer, false)}>
                        <text flexShrink={0} fg={checked() ? theme().success : theme().textMuted}>
                          {question.type === 'single' ? (checked() ? `(${icons.circle})` : `( )`) : checked() ? `[${icons.cross}]` : `[ ]`}
                        </text>
                        <box flexDirection="row" gap={1} flexShrink={1} flexWrap="wrap" minWidth={0}>
                          <text fg={hovered().answer === option.answer && hovered().index === questionIndex() ? theme().accent : theme().text}>{option.answer}</text>
                          <Show when={option.answerDescription}>
                            <text fg={theme().textMuted}>— {option.answerDescription}</text>
                          </Show>
                        </box>
                      </box>
                    )
                  }}
                </For>
                <box marginTop={1} onMouseUp={() => inputRefs[questionIndex()]?.focus()}>
                  <input
                    ref={(r) => {
                      inputRefs[questionIndex()] = r
                    }}
                    placeholder="Add a comment (optional)"
                    placeholderColor={theme().textMuted}
                    textColor={theme().text}
                    cursorColor={theme().accent}
                    backgroundColor={theme().backgroundElement}
                    width={commentWidth()}
                    onInput={(value) => setComment(questionIndex(), value)}
                  />
                </box>
              </box>
            </Show>
          )}
        </For>
        <Show when={isLastTab()}>
          <box flexDirection="column" marginTop={1} gap={1}>
            <For each={props.questions}>
              {(question, index) => (
                <box flexDirection="column">
                  <text fg={theme().textMuted}>
                    {index() + 1}. {clip(question.title, TAB_MAX_WIDTH)}
                  </text>
                  <text fg={(answers()[index()] ?? []).length > 0 ? theme().text : theme().warning}>
                    {'  '}
                    {(answers()[index()] ?? []).join(', ') || '(no answer)'}
                  </text>
                  <Show when={comments()[index()]?.trim()} keyed>
                    {(comment: string) => (
                      <text fg={theme().textMuted}>
                        {'  '}comment: {comment}
                      </text>
                    )}
                  </Show>
                </box>
              )}
            </For>
          </box>
        </Show>
        <box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
          <Show when={isLastTab() && allAnswered()}>
            <Button label={`${icons.send} Confirm answers`} isActive onClick={confirm} />
          </Show>
          <Button label={`${icons.cross} Dismiss`} onClick={cancel} />
        </box>
      </Show>
    </box>
  )
}
