import { theme } from "@states/theme-state.ts"
import { TextAttributes } from "@opentui/core"
import { getSharedTreeSitterClientSync } from "@wrappers/treesitter-wrapper.ts"
import { filetypeFromPath } from "@tui/components/diff.tsx"
import { Diff } from "@tui/components/diff.tsx"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, Show } from "solid-js"
import {
  previewToolInput,
  summarizeToolInput,
  summarizeToolOutput,
  toolDiff,
  toolDisplayName,
  toolProgress,
  toolAskQuestions,
  toolStateView,
  type ToolPartLike,
  type ToolTone,
} from "./tool-summary.ts"
import { AskForm } from "./ask-form.tsx"
import { TodoList } from "./todo-list.tsx"
import type { TodoItem } from "@agent/tools/flow/todo.ts"

export type ToolPartProps = {
  part: ToolPartLike
  /** Stable identity of the part within the session, tracking collapse state. */
  partKey: string
  /** Sends a follow-up user prompt; used by the interactive `ask` form. */
  onPrompt?: (text: string) => void
}

/** Collapse state lives outside the component so scroll virtualization, which
 * remounts children, does not reset it (same pattern as `ReasoningPart`). */
const [expandedKeys, setExpandedKeys] = createSignal<ReadonlySet<string>>(new Set())

const toneColor = (tone: ToolTone) => {
  switch (tone) {
    case "running":
      return theme().primary
    case "success":
      return theme().success
    case "error":
      return theme().error
    case "warning":
      return theme().warning
    case "info":
      return theme().info
    default:
      return theme().textMuted
  }
}

const isAskTool = (part: ToolPartLike): boolean =>
  part.type === "tool-ask" || (part.type === "dynamic-tool" && part.toolName === "ask")

const isTodoTool = (part: ToolPartLike): boolean =>
  part.type === "tool-todo" || (part.type === "dynamic-tool" && part.toolName === "todo")

const isTodoItem = (value: unknown): value is TodoItem =>
  typeof value === "object" && value !== null &&
  typeof (value as { title?: unknown }).title === "string" &&
  typeof (value as { done?: unknown }).done === "boolean"

const todoItems = (part: ToolPartLike): TodoItem[] | undefined => {
  const output = part.output
  if (typeof output === "object" && output !== null && Array.isArray((output as { items?: unknown }).items)) {
    const items = (output as { items: unknown[] }).items.filter(isTodoItem)
    if (items.length > 0) return items
  }
  const input = part.input
  if (typeof input === "object" && input !== null) {
    const actionType = (input as { actionType?: unknown }).actionType
    const action = (input as { action?: unknown }).action
    if (actionType === "ins" && typeof action === "object" && action !== null && Array.isArray((action as { ins?: unknown }).ins)) {
      const items = (action as { ins: unknown[] }).ins.filter(isTodoItem)
      if (items.length > 0) return items
    }
  }
  return undefined
}

/** Lines of the written file shown in the `code` preview; the rest is cut. */
const CODE_PREVIEW_MAX_LINES = 20

const writeContent = (part: ToolPartLike): string | undefined => {
  const output = part.output
  if (typeof output !== "object" || output === null) return undefined
  const content = (output as { content?: unknown }).content
  if (typeof content !== "string" || content.length === 0) return undefined
  const lines = content.split("\n")
  if (lines.length <= CODE_PREVIEW_MAX_LINES) return content
  return `${lines.slice(0, CODE_PREVIEW_MAX_LINES).join("\n")}\n…`
}

const writePath = (part: ToolPartLike): string => {
  const input = part.input
  if (typeof input !== "object" || input === null) return ""
  const path = (input as { path?: unknown }).path
  return typeof path === "string" ? path : ""
}

/**
 * Renders a single tool invocation as a tone-tinted block: a left rule in the
 * state's color groups the header (`◐ Read src/foo.tsx`) with its body —
 * the tool's latest streaming progress message while it runs, a muted
 * one-line output preview once it finishes, the written file highlighted in a
 * `code` block for `write`, the unified diff for `edit`, and the interactive
 * form for `ask`.
 */
export const ToolPart = (props: ToolPartProps) => {
  const [hovered, setHovered] = createSignal(false)
  const name = createMemo(() => toolDisplayName(props.part))
  const view = createMemo(() => toolStateView(props.part))
  const color = createMemo(() => toneColor(view().tone))
  const summary = createMemo(() => {
    const known = summarizeToolInput(name(), props.part.input)
    return known === "?" ? previewToolInput(props.part.input) : known
  })
  // Preliminary outputs are streaming chunks, not the final result: render the
  // tool's progress message instead of an output preview.
  const runningProgress = createMemo(() => toolProgress(props.part))
  const outputPreview = createMemo(() =>
    runningProgress() ? undefined : summarizeToolOutput(name(), props.part.output, props.part.errorText),
  )
  const diff = createMemo(() =>
    props.part.state === "output-available" ? toolDiff(props.part.output) : undefined,
  )
  const written = createMemo(() =>
    props.part.state === "output-available" ? writeContent(props.part) : undefined,
  )
  const questions = createMemo(() => (isAskTool(props.part) ? toolAskQuestions(props.part.input) : []))
  const todos = createMemo(() => (isTodoTool(props.part) ? todoItems(props.part) : undefined))

  const dims = useTerminalDimensions()
  const expanded = (): boolean =>
    todos() !== undefined || questions().length > 0 || expandedKeys().has(props.partKey)
  const toggle = () => {
    const key = props.partKey
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Collapsed content is a single clipped line: name plus the most informative
  // detail available (streaming progress, output summary, then input summary).
  const collapsedLine = createMemo(() => {
    const detail = [summary(), runningProgress() ?? outputPreview()]
      .filter((part) => typeof part === "string" && part.length > 0)
      .join(" · ")
    return `${name()} ${detail}`
  })
  const clipToWidth = (line: string): string => {
    // 6 covers the left border + padding, the icon, the gaps and a margin.
    const max = Math.max(8, dims().width - 6 - view().icon.length)
    return line.length > max ? `${line.slice(0, max - 1)}…` : line
  }

  return (
    <box
      flexDirection="column"
      paddingLeft={1}
      border={["left"]} bottomTitle={` ${name()} `} bottomTitleAlignment="right"
      borderStyle={"heavy"}
      borderColor={color()}
    >
      <Show
        when={expanded()}
        fallback={
          <box
            flexDirection="row" gap={1}
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
            onMouseUp={(event) => { event.stopPropagation(); toggle() }}
          >
            <text fg={color()} selectable={false}>{view().icon}</text>
            <text
              fg={hovered() ? theme().accent : theme().textMuted}
              attributes={hovered() ? TextAttributes.BOLD : undefined}
              selectable={false}
            >{clipToWidth(collapsedLine())}</text>
          </box>
        }
      >
      <box
        flexDirection="row" gap={1}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseUp={(event) => { event.stopPropagation(); toggle() }}
      >
        <text fg={color()} selectable={false}>{view().icon}</text>
        <text
          fg={color()}
          attributes={hovered() ? TextAttributes.BOLD : undefined}
        >{name()}</text>
        <text
          fg={theme().textMuted}
          attributes={hovered() ? TextAttributes.BOLD : undefined}
        >{summary()}</text>
      </box>
      <Show when={runningProgress()} keyed>
        {(progress: string) => <text fg={color()}>{progress}</text>}
      </Show>
      <Show when={written()} keyed>
        {(content: string) => (
          <code
            content={content}
            filetype={filetypeFromPath(writePath(props.part))}
            syntaxStyle={theme().syntax}
            treeSitterClient={getSharedTreeSitterClientSync()}
            conceal
          />
        )}
      </Show>
      <Show when={todos()} keyed>
        {(items: TodoItem[]) => <TodoList items={items} />}
      </Show>
      <Show when={diff()} keyed>
        {(diff: string) => <Diff diff={diff} />}
      </Show>
      <Show when={outputPreview() && todos() === undefined} keyed>
        {(preview: string) => <text fg={theme().textMuted}>{preview}</text>}
      </Show>
      </Show>
      <Show when={questions().length > 0}>
        <AskForm questions={questions()} onConfirm={(text) => props.onPrompt?.(text)} />
      </Show>
    </box>
  )
}
