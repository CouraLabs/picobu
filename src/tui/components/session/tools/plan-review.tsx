import type { InputRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, For, Show } from "solid-js"
import { theme } from "@states/theme-state.ts"
import { icons } from "@tui/themes/icons.ts"
import { Button } from "@tui/components/button.tsx"

export type PlanVerdict = "approved" | "rejected"

export type PlanReviewProps = {
  plan: string
  status?: string
  outputMessage?: string
  interactive: boolean
  onVerdict: (status: PlanVerdict, message: string, compact: boolean) => void | Promise<void>
  onCancel: () => void | Promise<void>
}

const LINE_MAX = 120

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export const PlanReview = (props: PlanReviewProps) => {
  const dims = useTerminalDimensions()
  const lines = () => props.plan.split("\n").filter((l) => l.trim().length > 0)
  const [lineComments, setLineComments] = createSignal<string[]>(lines().map(() => ""))
  const [openLine, setOpenLine] = createSignal<number | undefined>(undefined)
  const [overall, setOverall] = createSignal("")
  const [compact, setCompact] = createSignal(true)
  const [responded, setResponded] = createSignal(false)
  const [dismissed, setDismissed] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  const lineRefs: (InputRenderable | null)[] = []
  let overallRef: InputRenderable | null = null

  const readonly = () => !props.interactive || sending() || responded() || (props.status !== undefined && props.status !== "pending")
  const wasDismissed = () => props.status === "cancelled" || (responded() && dismissed() && props.status !== "approved" && props.status !== "rejected")

  const setLineComment = (index: number, value: string) => {
    if (readonly()) return
    setLineComments((prev) => {
      const next = [...prev]
      while (next.length < lines().length) next.push("")
      next[index] = value
      return next
    })
  }

  const hasComment = () =>
    lineComments().some((c) => c.trim().length > 0) || overall().trim().length > 0

  const buildMessage = (): string => {
    const parts: string[] = []
    lines().forEach((line, index) => {
      const comment = (lineComments()[index] ?? "").trim()
      if (comment) parts.push(`Line ${index + 1} "${truncate(line.trim(), 80)}": ${comment}`)
    })
    const all = overall().trim()
    if (all) parts.push(`Overall: ${all}`)
    return parts.join("\n")
  }

  const verdict = async (status: PlanVerdict) => {
    if (readonly()) return
    if (status === "rejected" && !hasComment()) return
    const message = buildMessage()
    setSending(true)
    try {
      await props.onVerdict(status, message.length > 0 ? message : "Approved", compact())
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

  const maxWidth = () => Math.max(24, dims().width - 10)

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
                  when={props.status !== undefined && props.status !== "pending" && props.outputMessage}
                  fallback={
                    <For each={lines()}>
                      {(line, index) => (
                        <box flexDirection="column">
                          <text fg={theme().textMuted}>{`${index() + 1}. ${truncate(line.trim(), Math.min(LINE_MAX, maxWidth()))}`}</text>
                          <Show when={(lineComments()[index()] ?? "").trim()} keyed>
                            {(comment: string) => <text fg={theme().accent}>{`  ${icons.flag} ${comment}`}</text>}
                          </Show>
                        </box>
                      )}
                    </For>
                  }
                >
                  {(message: () => string | undefined) => (
                    <box flexDirection="column">
                      <text fg={props.status === "rejected" ? theme().error : theme().success}>
                        {props.status === "rejected" ? `${icons.cross} Rejected` : `${icons.success} Approved`}
                      </text>
                      <For each={(message() ?? "").split("\n")}>
                        {(line) => <text fg={theme().textMuted}>{line}</text>}
                      </For>
                    </box>
                  )}
                </Show>
              }
            >
              <text fg={theme().warning}>{`${icons.cross} Review dismissed.`}</text>
            </Show>
          </box>
        }
      >
        <For each={lines()}>
          {(line, index) => {
            const commented = () => (lineComments()[index()] ?? "").trim().length > 0
            return (
              <box flexDirection="column">
                <box flexDirection="row" gap={1} height={1} onMouseUp={() => setOpenLine(openLine() === index() ? undefined : index())}>
                  <text fg={commented() ? theme().accent : theme().textMuted} selectable={false}>
                    {commented() ? icons.flag : icons.folder}
                  </text>
                  <text fg={theme().textMuted} selectable={false}>{index() + 1}</text>
                  <text fg={commented() ? theme().text : theme().textMuted}>
                    {truncate(line.trim(), Math.min(LINE_MAX, maxWidth()))}
                  </text>
                </box>
                <Show when={commented()}>
                  <text fg={theme().accent}>{`  ${icons.edit} ${(lineComments()[index()] ?? "").trim()}`}</text>
                </Show>
                <Show when={openLine() === index()}>
                  <box marginTop={0} marginLeft={4} onMouseUp={() => lineRefs[index()]?.focus()}>
                    <input
                      ref={(r) => {
                        lineRefs[index()] = r
                      }}
                      value={lineComments()[index()] ?? ""}
                      placeholder={`Comment on line ${index() + 1} (optional, clear to remove)`}
                      placeholderColor={theme().textMuted}
                      textColor={theme().text}
                      cursorColor={theme().accent}
                      backgroundColor={theme().backgroundElement}
                      width={Math.min(72, maxWidth())}
                      onInput={(value) => setLineComment(index(), value)}
                    />
                  </box>
                </Show>
              </box>
            )
          }}
        </For>
        <box marginTop={1} onMouseUp={() => overallRef?.focus()}>
          <input
            ref={(r) => {
              overallRef = r
            }}
            value={overall()}
            placeholder="Overall comment (optional, required to request changes)"
            placeholderColor={theme().textMuted}
            textColor={theme().text}
            cursorColor={theme().accent}
            backgroundColor={theme().backgroundElement}
            width={Math.min(72, maxWidth())}
            onInput={(value) => {
              if (!readonly()) setOverall(value)
            }}
          />
        </box>
        <box flexDirection="row" gap={1} height={1} marginTop={1} onMouseUp={() => setCompact(!compact())}>
          <text fg={compact() ? theme().success : theme().textMuted} selectable={false}>
            {compact() ? icons.checkSquare : icons.uncheckedSquare}
          </text>
          <text fg={theme().textMuted} selectable={false}>Compact context before handoff</text>
        </box>
        <box flexDirection="row" gap={1} marginTop={1}>
          <Button label={`${icons.success} Approve`} isActive onClick={() => verdict("approved")} />
          <Show when={hasComment()}>
            <Button label={`${icons.edit} Request changes`} onClick={() => verdict("rejected")} />
          </Show>
          <Button label={`${icons.cross} Dismiss`} onClick={cancel} />
        </box>
      </Show>
    </box>
  )
}
