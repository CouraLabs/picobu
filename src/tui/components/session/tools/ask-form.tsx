import type { InputRenderable } from "@opentui/core"
import { createEffect, createSignal, For, Show } from "solid-js"
import { theme } from "@states/theme-state.ts"
import { icons } from "@tui/themes/icons.ts"
import { Button } from "@tui/components/button.tsx"
import type { AskQuestionView } from "./tool-summary.ts"

export type AskFormProps = {
  questions: AskQuestionView[]
  /** Called with the formatted answers when the user confirms the summary. */
  onConfirm: (answersText: string) => void
}

const TAB_MAX_WIDTH = 24
const COMMENT_MAX_WIDTH = 48

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/**
 * Interactive form for a pending `ask` invocation: one tab per question with
 * radio (type `single`) or checkbox (type `multiple`) options plus an optional
 * free-text comment, and a final summary tab with a confirm button shown only
 * once every question has at least one answer. Confirming emits the answers as
 * compact "Title: answer" lines so the host can send them back as a follow-up
 * user prompt. After confirming the form collapses into a read-only summary.
 */
export const AskForm = (props: AskFormProps) => {
  // One tab per question plus the trailing summary tab (index === questions.length).
  const [active, setActive] = createSignal(0)
  const [answers, setAnswers] = createSignal<string[][]>(props.questions.map(() => []))
  const [comments, setComments] = createSignal<string[]>(props.questions.map(() => ""))
  const [sent, setSent] = createSignal(false)
  const inputRefs: (InputRenderable | null)[] = []

  // Questions may stream in after mount (partial tool-input deltas): keep the
  // per-question state arrays aligned with the question list.
  createEffect(() => {
    const count = props.questions.length
    setAnswers((prev) => (prev.length === count ? prev : [...prev.slice(0, count), ...Array.from({ length: Math.max(0, count - prev.length) }, () => [])]))
    setComments((prev) => (prev.length === count ? prev : [...prev.slice(0, count), ...Array.from({ length: Math.max(0, count - prev.length) }, () => "")]))
  })

  const summaryIndex = () => props.questions.length
  const isLastTab = () => active() >= summaryIndex()

  const toggle = (questionIndex: number, answer: string) => {
    if (sent()) return
    setAnswers((prev) =>
      prev.map((selected, index) => {
        if (index !== questionIndex) return selected
        if (selected.includes(answer)) return selected.filter((a) => a !== answer)
        // Radio questions hold a single choice; checkbox questions accumulate.
        return props.questions[index]?.type === "single" ? [answer] : [...selected, answer]
      }),
    )
  }

  const setComment = (questionIndex: number, value: string) => {
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

  const confirm = () => {
    if (sent()) return
    setSent(true)
    props.onConfirm(buildAnswersText())
  }

  const tabColor = (tabIndex: number) => (active() === tabIndex ? theme().text : theme().textMuted)
  const tabBackground = (tabIndex: number) => (active() === tabIndex ? theme().primary : theme().backgroundElement)

  return (
    <box flexDirection="column" marginTop={1}>
      <Show
        when={!sent()}
        fallback={
          <box flexDirection="column" gap={1}>
            <For each={props.questions}>
              {(question, index) => {
                // A single string per line: <text> children must be strings,
                // nested renderables are not supported here.
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
            <text fg={theme().success}>Answers sent.</text>
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
        <Show when={isLastTab() && allAnswered()}>
          <box marginTop={1}>
            <Button label={`${icons.send} Confirm answers`} isActive onClick={confirm} />
          </box>
        </Show>
      </Show>
    </box>
  )
}
