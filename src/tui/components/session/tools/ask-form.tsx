import type { InputRenderable } from "@opentui/core"
import { createEffect, createSignal, For, Show } from "solid-js"
import { theme } from "@states/theme-state.ts"
import { icons } from "@tui/themes/icons.ts"
import { Button } from "@tui/components/button.tsx"
import type { AskQuestionView } from "./tool-summary.ts"

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

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export const AskForm = (props: AskFormProps) => {
  const [active, setActive] = createSignal(0)
  const [answers, setAnswers] = createSignal<string[][]>(props.questions.map(() => []))
  const [comments, setComments] = createSignal<string[]>(props.questions.map(() => ""))
  const [responded, setResponded] = createSignal(false)
  const [dismissed, setDismissed] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  const inputRefs: (InputRenderable | null)[] = []

  createEffect(() => {
    const count = props.questions.length
    setAnswers((prev) => (prev.length === count ? prev : [...prev.slice(0, count), ...Array.from({ length: Math.max(0, count - prev.length) }, () => [])]))
    setComments((prev) => (prev.length === count ? prev : [...prev.slice(0, count), ...Array.from({ length: Math.max(0, count - prev.length) }, () => "")]))
  })

  const summaryIndex = () => props.questions.length
  const isLastTab = () => active() >= summaryIndex()
  const readonly = () => !props.interactive || sending() || responded() || (props.status !== undefined && props.status !== "pending")
  const wasDismissed = () => props.status === "cancelled" || (responded() && dismissed() && props.status !== "answered")
  const settledTerminal = () => props.status !== undefined && props.status !== "pending" && props.status !== "cancelled"
  const echoed = () => settledTerminal() && !!props.outputMessage

  const toggle = (questionIndex: number, answer: string) => {
    if (readonly()) return
    setAnswers((prev) =>
      prev.map((selected, index) => {
        if (index !== questionIndex) return selected
        if (selected.includes(answer)) return selected.filter((a) => a !== answer)
        return props.questions[index]?.type === "single" ? [answer] : [...selected, answer]
      }),
    )
  }

  const setComment = (questionIndex: number, value: string) => {
    if (readonly()) return
    setComments((prev) => prev.map((comment, index) => (index === questionIndex ? value : comment)))
  }

  const allAnswered = () => props.questions.every((_, index) => (answers()[index] ?? []).length > 0)

  const buildAnswersText = (): string =>
    props.questions
      .map((question, index) => {
        const selected = (answers()[index] ?? []).join(", ") || "(no answer)"
        const comment = comments()[index]?.trim()
        return comment ? `${question.title}: ${selected} — ${comment}` : `${question.title}: ${selected}`
      })
      .join("\n")

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

  const tabColor = (tabIndex: number) => (active() === tabIndex ? theme().text : theme().textMuted)
  const tabBackground = (tabIndex: number) => (active() === tabIndex ? theme().primary : theme().backgroundElement)

  return (
    <box flexDirection="column" marginTop={1}>
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
                      when={responded() || settledTerminal()}
                      fallback={
                        <text fg={theme().textMuted}>{`${icons.question} Awaiting your answers.`}</text>
                      }
                    >
                      <For each={props.questions}>
                        {(question, index) => {
                          const comment = comments()[index()]?.trim()
                          const line =
                            `${icons.success} ${truncate(question.title, TAB_MAX_WIDTH)}: ` +
                            `${(answers()[index()] ?? []).join(", ") || "(no answer)"}` +
                            (comment ? ` · ${comment}` : "")
                          return (
                            <box flexDirection="column">
                              <text fg={theme().textMuted}>{line}</text>
                            </box>
                          )
                        }}
                      </For>
                    </Show>
                  }
                >
                  {(message: () => string | undefined) => (
                    <For each={(message() ?? "").split("\n")}>
                      {(line) => <text fg={theme().textMuted}>{`${icons.success} ${line}`}</text>}
                    </For>
                  )}
                </Show>
              }
            >
              <text fg={theme().warning}>{`${icons.cross} Dismissed without answering.`}</text>
            </Show>
            <Show
              when={wasDismissed() || responded() || settledTerminal()}
              fallback={
                <text fg={theme().textMuted}>Awaiting answers.</text>
              }
            >
              <text fg={theme().success}>{wasDismissed() ? "Dismissed." : "Answers sent."}</text>
            </Show>
          </box>
        }
      >
        <box flexDirection="row" gap={1}>
          <For each={props.questions}>
            {(question, index) => (
              <box
                height={1}
                paddingX={1}
                backgroundColor={tabBackground(index())}
                onMouseUp={() => setActive(index())}
              >
                <text fg={tabColor(index())}>{truncate(question.title, TAB_MAX_WIDTH)}</text>
              </box>
            )}
          </For>
          <box
            height={1}
            paddingX={1}
            backgroundColor={tabBackground(summaryIndex())}
            onMouseUp={() => setActive(summaryIndex())}
          >
            <text fg={tabColor(summaryIndex())}>{icons.success} Summary</text>
          </box>
        </box>
        <For each={props.questions}>
          {(question, index) => (
            <Show when={active() === index()}>
              <box flexDirection="column" marginTop={1}>
                <Show when={question.question.length > 0}>
                  <text fg={theme().text}>{question.question}</text>
                </Show>
                <For each={question.options}>
                  {(option) => {
                    const checked = () => (answers()[index()] ?? []).includes(option.answer)
                    return (
                      <box
                        flexDirection="row"
                        gap={1}
                        height={1}
                        onMouseUp={() => toggle(index(), option.answer)}
                      >
                        <text
                          fg={checked() ? theme().success : theme().textMuted}
                        >
                          {question.type === "single"
                            ? checked()
                              ? icons.circle
                              : icons.outlineCircle
                            : checked()
                              ? icons.checkSquare
                              : icons.uncheckedSquare}
                        </text>
                        <text fg={theme().text}>{option.answer}</text>
                        <Show when={option.answerDescription}>
                          <text fg={theme().textMuted}>— {option.answerDescription}</text>
                        </Show>
                      </box>
                    )
                  }}
                </For>
                <box marginTop={1} onMouseUp={() => inputRefs[index()]?.focus()}>
                  <input
                    ref={(r) => {
                      inputRefs[index()] = r
                    }}
                    placeholder="Add a comment (optional)"
                    placeholderColor={theme().textMuted}
                    textColor={theme().text}
                    cursorColor={theme().accent}
                    backgroundColor={theme().backgroundElement}
                    width={COMMENT_MAX_WIDTH + 2}
                    onInput={(value) => setComment(index(), value)}
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
                    {index() + 1}. {truncate(question.title, TAB_MAX_WIDTH)}
                  </text>
                  <text fg={(answers()[index()] ?? []).length > 0 ? theme().text : theme().warning}>
                    {"  "}
                    {(answers()[index()] ?? []).join(", ") || "(no answer)"}
                  </text>
                  <Show when={comments()[index()]?.trim()} keyed>
                    {(comment: string) => <text fg={theme().textMuted}>{"  "}comment: {comment}</text>}
                  </Show>
                </box>
              )}
            </For>
          </box>
        </Show>
        <box flexDirection="row" gap={1} marginTop={1}>
          <Show when={isLastTab() && allAnswered()}>
            <Button label={`${icons.send} Confirm answers`} isActive onClick={confirm} />
          </Show>
          <Button label={`${icons.cross} Dismiss`} onClick={cancel} />
        </box>
      </Show>
    </box>
  )
}
