import { icons } from "@tui/themes/icons.ts"

/**
 * Pure helpers to describe tool UI parts for rendering.
 *
 * Tool parts follow the AI SDK UI message shape: `type` is `tool-<name>` for
 * known tools or `dynamic-tool` (with a `toolName` field) for provider-side
 * tools. The rest of the shape is intentionally loose because parts arrive
 * from streamed, provider-specific payloads.
 */

export type ToolPartLike = {
  type: string
  toolName?: string
  toolCallId?: string
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
}

export type ToolTone = "running" | "pending" | "success" | "error" | "warning" | "info"

export type ToolStateView = {
  icon: string
  tone: ToolTone
}

const DYNAMIC_TOOL_TYPE = "dynamic-tool"
const TOOL_TYPE_PREFIX = "tool-"

export const isToolPart = (part: unknown): part is ToolPartLike =>
  typeof part === "object" &&
  part !== null &&
  typeof (part as { type?: unknown }).type === "string" &&
  ((part as { type: string }).type.startsWith(TOOL_TYPE_PREFIX) || (part as { type: string }).type === DYNAMIC_TOOL_TYPE)

/** Returns the tool part when the given message part is a tool invocation. */
export const asToolPart = (part: unknown): ToolPartLike | undefined => (isToolPart(part) ? part : undefined)

/** Raw tool identifier, e.g. `read` or the dynamic tool's `toolName`. */
export const rawToolName = (part: ToolPartLike): string =>
  part.type === DYNAMIC_TOOL_TYPE ? (part.toolName ?? "tool") : part.type.slice(TOOL_TYPE_PREFIX.length)

/** Human readable tool name, works for both `tool-<name>` and `dynamic-tool`. */
export const toolDisplayName = (part: ToolPartLike): string => {
  const name = rawToolName(part)
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * AI SDK marks intermediate outputs of async-generator tools (e.g. streaming
 * `progress` chunks from websearch) as `preliminary` while the tool is still
 * running; the final yield arrives as a regular (non-preliminary) result.
 */
export const isPreliminaryToolResult = (part: ToolPartLike): boolean =>
  (part as { preliminary?: unknown }).preliminary === true

export const toolStateView = (part: ToolPartLike): ToolStateView => {
  switch (part.state) {
    case "input-streaming":
      return { icon: icons.running, tone: "running" }
    case "output-available":
      // Preliminary results stream in while the tool is still executing.
      if (isPreliminaryToolResult(part)) return { icon: icons.running, tone: "running" }
      return { icon: icons.success, tone: "success" }
    case "output-error":
      return { icon: icons.error, tone: "error" }
    case "output-denied":
      return { icon: icons.warning, tone: "warning" }
    case "approval-requested":
      return { icon: icons.question, tone: "pending" }
    case "approval-responded":
      return { icon: icons.info, tone: "info" }
    default:
      return { icon: icons.pending, tone: "pending" }
  }
}

/**
 * Latest streaming progress message of a running tool, e.g. `Fetching results
 * 5–8 of 10…`. Returns `undefined` once the tool finishes or for tools that
 * don't stream progress.
 */
export const toolProgress = (part: ToolPartLike): string | undefined => {
  if (!isPreliminaryToolResult(part)) return undefined
  const progress = (part.output as { progress?: unknown } | undefined)?.progress
  return typeof progress === "string" && progress.length > 0 ? progress : undefined
}

/** Short action title for known tools, e.g. `Read src/foo.ts` or `Shell bun test`. */
export const summarizeToolInput = (name: string, input: unknown): string => {
  const args = (input ?? {}) as Record<string, unknown>
  const field = (key: string): string | undefined => {
    const value = args[key]
    return typeof value === "string" ? value : undefined
  }
  switch (name.toLowerCase()) {
    case "read": {
      const range =
        typeof args.fromLine === "number" && typeof args.toLine === "number" ? `:${args.fromLine}-${args.toLine}` : ""
      return `${field("path") ?? "?"}${range}`
    }
    case "write":
    case "edit":
      return field("path") ?? "?"
    case "glob":
    case "grep":
      return field("pattern") ?? "?"
    case "shell":
      return field("command") ?? "?"
    case "websearch":
      return field("query") ?? "?"
    case "webfetch":
      return field("url") ?? "?"
    case "skill":
    case "rule":
      return field("name") ?? "?"
    case "ask": {
      const questions = args.questions
      const first = Array.isArray(questions) ? (questions[0] as Record<string, unknown> | undefined) : undefined
      const title = first && typeof first.title === "string" ? first.title : undefined
      return title ?? "?"
    }
    case "plan-write": {
      const plan = field("plan")
      if (plan === undefined) return "?"
      const lines = plan.length === 0 ? 0 : plan.split("\n").length
      return `${lines} lines`
    }
    case "todo": {
      const actionType = typeof args.actionType === "string" ? args.actionType : ""
      const action = (args.action ?? {}) as Record<string, unknown>
      if (actionType === "ins") {
        const added = Array.isArray(action.ins) ? action.ins : undefined
        return added ? `+${added.length}` : "?"
      }
      if (actionType === "del") return "remove"
      if (actionType === "upd") return "update"
      return "?"
    }
    default:
      return "?"
  }
}

const INPUT_PREVIEW_MAX = 120
const OUTPUT_PREVIEW_MAX = 200
const ERROR_PREVIEW_MAX = 400

/** Collapses any value into a single truncated line for inline previews. */
const singleLine = (value: unknown, max: number): string => {
  const text = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value)
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** One-line preview of a tool input for unknown tools. */
export const previewToolInput = (input: unknown): string => singleLine(input, INPUT_PREVIEW_MAX)

const countLines = (text: string): number => (text.length === 0 ? 0 : text.split(/\r?\n/).length)

/**
 * One-line summary of a tool's result. Known tools get a compact structural
 * summary (counts, stats); anything else falls back to a truncated text
 * preview. Returns `undefined` when there is nothing worth showing.
 */
export const summarizeToolOutput = (name: string, output: unknown, errorText?: string): string | undefined => {
  if (errorText) return singleLine(errorText, ERROR_PREVIEW_MAX)
  if (output === undefined || output === null || output === "") return undefined

  const args = typeof output === "object" ? (output as Record<string, unknown>) : undefined
  switch (name.toLowerCase()) {
    case "read":
    case "grep": {
      const content = args && typeof args.content === "string" ? args.content : undefined
      const filetype = args && typeof args.filetype === "string" ? args.filetype : ""
      return content !== undefined ? `${countLines(content)} lines${filetype ? ` · ${filetype}` : ""}` : undefined
    }
    case "glob":
      return typeof output === "string" ? `${countLines(output)} matches` : undefined
    case "write": {
      // Current outputs carry a `{ message, content }` result; older persisted
      // sessions may hold a `{ message, diff }` or the raw streamed string.
      if (typeof output === "string") return `${countLines(output)} lines written`
      const content = args && typeof args.content === "string" ? args.content : undefined
      if (content !== undefined) return `${countLines(content)} lines written`
      const diff = args && typeof args.diff === "string" ? args.diff : undefined
      if (diff === undefined) break
      const stats = diffStats(diff)
      return `${stats.added}+ ${stats.removed}−`
    }
    case "edit": {
      const diff = args && typeof args.diff === "string" ? args.diff : undefined
      if (diff === undefined) break
      const stats = diffStats(diff)
      return `${stats.added}+ ${stats.removed}−`
    }
    case "shell": {
      if (typeof output !== "string") break
      const lines = output.split(/\r?\n/)
      if (lines.length <= 1) return singleLine(output, OUTPUT_PREVIEW_MAX)
      // The last line is often bare syntax noise (a closing `}` of a JSON
      // object, an empty trailing line, …) which renders as a stray
      // character after `N lines ·`; preview the last meaningful line instead.
      const previewLine = [...lines]
        .reverse()
        .find((line) => {
          const trimmed = line.trim()
          return trimmed.length > 0 && !/^[}\])>;,.]+$/.test(trimmed)
        })
      return `${countLines(output)} lines${previewLine ? ` · ${singleLine(previewLine, 80)}` : ""}`
    }
    case "websearch": {
      const results = args && Array.isArray(args.results) ? args.results : undefined
      return results ? `${results.length} results` : undefined
    }
    case "ask": {
      const message = args && typeof args.message === "string" ? args.message : undefined
      return message !== undefined && message.length > 0 ? singleLine(message, OUTPUT_PREVIEW_MAX) : undefined
    }
    case "plan-write": {
      const message = args && typeof args.message === "string" ? args.message : undefined
      const status = args && typeof args.status === "string" ? args.status : undefined
      const label = status !== undefined && status !== "pending" ? `${status} · ` : ""
      return message !== undefined && message.length > 0 ? `${label}${singleLine(message, OUTPUT_PREVIEW_MAX)}` : (status ? label.trim() : undefined)
    }
    case "todo": {
      const items = args && Array.isArray(args.items) ? args.items : undefined
      if (!items) break
      const done = items.filter((item) => (item as { done?: unknown } | undefined)?.done === true).length
      return `${done} of ${items.length} done`
    }
    case "webfetch": {
      const content = args && typeof args.content === "string" ? args.content : undefined
      return content !== undefined ? `${countLines(content)} lines` : undefined
    }
    default:
      return singleLine(output, OUTPUT_PREVIEW_MAX)
  }
}

/** Added/removed line counts for a unified diff (ignoring `+++`/`---` headers). */
export const diffStats = (diff: string): { added: number; removed: number } => {
  let added = 0
  let removed = 0
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+")) added++
    else if (line.startsWith("-")) removed++
  }
  return { added: added - (diff.includes("+++ ") ? 1 : 0), removed: removed - (diff.includes("--- ") ? 1 : 0) }
}

/** Raw unified diff of an `edit` output, if present and non-empty. */
export const toolDiff = (output: unknown): string | undefined => {
  const diff = typeof output === "object" && output !== null ? (output as { diff?: unknown }).diff : undefined
  return typeof diff === "string" && diff.length > 0 ? diff : undefined
}

/** Parsed option of an `ask` question. */
export type AskOptionView = {
  answer: string
  answerDescription?: string
}

/** Parsed question of an `ask` invocation, for rendering the interactive form. */
export type AskQuestionView = {
  title: string
  question: string
  type: "single" | "multiple"
  options: AskOptionView[]
}

export const toolAskQuestions = (input: unknown): AskQuestionView[] => {
  const questions = (input as { questions?: unknown } | undefined)?.questions
  if (!Array.isArray(questions)) return []
  return questions.flatMap((q): AskQuestionView[] => {
    if (typeof q !== "object" || q === null) return []
    const { title, question, type, options } = q as Record<string, unknown>
    if (typeof title !== "string" || title.length === 0) return []
    const parsedType = type === "multiple" ? "multiple" : "single"
    const parsedOptions = (Array.isArray(options) ? options : []).flatMap((o): AskOptionView[] => {
      if (typeof o !== "object" || o === null) return []
      const { answer, answerDescription } = o as Record<string, unknown>
      if (typeof answer !== "string" || answer.length === 0) return []
      return [{ answer, answerDescription: typeof answerDescription === "string" && answerDescription.length > 0 ? answerDescription : undefined }]
    })
    if (parsedOptions.length === 0) return []
    return [{ title, question: typeof question === "string" ? question : "", type: parsedType, options: parsedOptions }]
  })
}

export const flowOutputStatus = (part: ToolPartLike): string | undefined => {
  const output = part.output as { status?: unknown } | undefined
  return output !== null && typeof output === "object" && typeof output.status === "string" ? output.status : undefined
}

export const flowOutputMessage = (part: ToolPartLike): string => {
  const output = part.output as { message?: unknown } | undefined
  return output !== null && typeof output === "object" && typeof output.message === "string" ? output.message : ""
}

export const planText = (input: unknown): string | undefined => {
  const plan = (input as { plan?: unknown } | undefined)?.plan
  return typeof plan === "string" && plan.length > 0 ? plan : undefined
}
