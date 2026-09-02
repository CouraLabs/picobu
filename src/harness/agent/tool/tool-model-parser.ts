import type { ToolCallModel, ToolStatus } from "../../../components/session/ToolCall";
import type { TodoItem } from "../../../components/session/tools/TodoToolCall";
import type { AskQuestion } from "../../../stores/interaction-store";

export type ToolPart = {
  type: string;
  state?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/** Context the renderer passes for interrupt flow tools (ask / plan-write). */
export type ToolPartContext = {
  /** Stable part key (`<messageId>-<toolName>-<index>`) keying UI-side state. */
  partKey?: string;
  /** True when this is the last `ask` part in the message list (the live one). */
  isPendingAsk?: boolean;
  /** True when this is the last `plan-write` part in the message list (the live one). */
  isPendingPlanWrite?: boolean;
  /** True when a user message follows the assistant message that contains this part. */
  hasFollowingUserMessage?: boolean;
};

/** Coerce raw ask input into renderable questions, skipping malformed entries. */
const normalizeAskQuestions = (input: Record<string, unknown>): AskQuestion[] => {
  const raw = Array.isArray(input.questions) ? (input.questions as unknown[]) : [];
  return raw.flatMap((r) => {
    const q = (r ?? {}) as Record<string, unknown>;
    if (typeof q.title !== "string" || typeof q.question !== "string") return [];
    const options = Array.isArray(q.options)
      ? (q.options as unknown[]).flatMap((o) => {
          const oo = (o ?? {}) as Record<string, unknown>;
          if (typeof oo.answer !== "string" || !oo.answer.trim()) return [];
          return [
            {
              answer: oo.answer,
              answerDescription: typeof oo.answerDescription === "string" ? oo.answerDescription : "",
            },
          ];
        })
      : [];
    return [
      {
        title: q.title,
        question: q.question,
        type: q.type === "multiple" ? "multiple" : "single",
        options,
      },
    ];
  });
};

/** Extract a renderable tool-call model from a tool part, parsing input (args) and output/error. */
export function toolPartToModel(part: ToolPart, ctx: ToolPartContext = {}): ToolCallModel | null {
  const name: string =
    part.type === "dynamic-tool" ? (part.toolName ?? "") : part.type.replace(/^tool-/, "");

  const status: ToolStatus = part.state === "output-error" ? "error" : "success";
  const input = (part.input ?? {}) as Record<string, unknown>;
  const error = part.state === "output-error" ? part.errorText : undefined;
  // `output` is only meaningful once the tool has produced it.
  const outputText =
    part.state === "output-available" && typeof part.output === "string"
      ? part.output
      : undefined;
  const editOutput =
    part.state === "output-available"
      ? (part.output as { message?: string; diff?: string } | undefined)
      : undefined;
  // read/grep tools return `{ filetype, content }` so the UI can render with the
  // file's syntax highlighting.
  const fileOutput = (part.state === "output-available"
    ? (part.output as { filetype?: string; content?: string } | undefined)
    : undefined);
  const filetype =
    typeof fileOutput?.filetype === "string" ? fileOutput.filetype : undefined;
  const fileContent =
    typeof fileOutput?.content === "string" ? fileOutput.content : outputText;

  switch (name) {
    case "read":
      return {
        name: "read",
        status,
        error,
        path: String(input.path ?? ""),
        output: fileContent,
        filetype,
        range: {
          from: typeof input.fromLine === "number" ? input.fromLine : undefined,
          to: typeof input.toLine === "number" ? input.toLine : undefined,
        },
      };
    case "edit":
      return {
        name: "edit",
        status,
        error,
        path: String(input.path ?? ""),
        message: editOutput?.message,
        diff: editOutput?.diff,
      };
    case "write":
      return { name: "write", status, error, path: String(input.path ?? ""), output: outputText, content: String((input as Record<string, unknown>).contents ?? "") };
    case "bash":
      return {
        name: "bash",
        status,
        error,
        command: String(input.command ?? ""),
        cwd: typeof input.cwd === "string" ? input.cwd : undefined,
        output: outputText,
      };
    case "grep":
      return {
        name: "grep",
        status,
        error,
        pattern: String(input.pattern ?? ""),
        path: typeof input.path === "string" ? input.path : undefined,
        output: fileContent,
        filetype,
      };
    case "glob":
      return { name: "glob", status, error, pattern: String(input.pattern ?? ""), output: outputText };
    case "todo": {
      // Flow tool: the output is the full todo list, rendered as a phase tree.
      const todoOutput =
        part.state === "output-available"
          ? (part.output as { items?: unknown } | undefined)
          : undefined;
      const rawItems = Array.isArray(todoOutput?.items) ? (todoOutput!.items as unknown[]) : [];
      const items: TodoItem[] = rawItems.map((raw) => {
        const it = (raw ?? {}) as Record<string, unknown>;
        return {
          phase: String(it.phase ?? ""),
          title: String(it.title ?? ""),
          prompt: String(it.prompt ?? ""),
          done: it.done === true,
        };
      });
      return { name: "todo", status, error, items };
    }
    case "websearch": {
      // External tool: the output carries the result list rendered by the UI.
      const searchOutput =
        part.state === "output-available"
          ? (part.output as { results?: unknown } | undefined)
          : undefined;
      const rawResults = Array.isArray(searchOutput?.results) ? (searchOutput!.results as unknown[]) : [];
      const results = rawResults.map((raw) => {
        const r = (raw ?? {}) as Record<string, unknown>;
        return {
          title: String(r.title ?? ""),
          url: String(r.url ?? ""),
          snippet: String(r.snippet ?? ""),
          content: typeof r.content === "string" ? r.content : null,
        };
      });
      return {
        name: "websearch",
        status,
        error,
        query: String(input.query ?? ""),
        deepness: typeof input.deepness === "number" ? input.deepness : undefined,
        results,
      };
    }
    case "webfetch": {
      const fetchOutput =
        part.state === "output-available"
          ? (part.output as { contentType?: string; content?: string } | undefined)
          : undefined;
      return {
        name: "webfetch",
        status,
        error,
        url: String(input.url ?? ""),
        contentType: typeof fetchOutput?.contentType === "string" ? fetchOutput.contentType : undefined,
        output: fetchOutput?.content,
      };
    }
    case "wwp-msg":
    case "wwp-alert":
    case "wwp-list-alerts":
    case "wwp-rm-alert":
    case "wwp-today":
    case "wwp-reminder":
    case "wwp-list-reminders":
    case "wwp-rm-reminder":
      // Integration tools render generically: name + args summary + output.
      return {
        name: "wwp",
        tool: name,
        status,
        error,
        summary: Object.entries(input)
          .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
          .join(" · "),
        output:
          part.state === "output-available"
            ? ((part.output as { message?: string })?.message ??
              (part.output ? JSON.stringify(part.output) : "done"))
            : undefined,
      };
    case "ask": {
      // Flow tool: the questions are the tool input; rendering is interactive.
      return {
        name: "ask",
        status,
        error,
        questions: normalizeAskQuestions(input),
        partKey: ctx.partKey ?? "",
        isPending: ctx.isPendingAsk ?? false,
        hasFollowingUserMessage: ctx.hasFollowingUserMessage ?? false,
      };
    }
    case "plan-write": {
      // Flow tool: the submitted plan is the tool input; a review dialog opens
      // when this part is the pending (last) plan-write submission.
      return {
        name: "plan-write",
        status,
        error,
        plan: String((input as Record<string, unknown>).plan ?? ""),
        partKey: ctx.partKey ?? "",
        isPending: ctx.isPendingPlanWrite ?? false,
        hasFollowingUserMessage: ctx.hasFollowingUserMessage ?? false,
      };
    }
    case "plan-exit": {
      // Flow tool: Plan -> Coder handoff, rendered from its output message.
      const exitOutput =
        part.state === "output-available"
          ? (part.output as { switchedTo?: string; message?: string } | undefined)
          : undefined;
      return {
        name: "plan-exit",
        status,
        error,
        switchedTo: typeof exitOutput?.switchedTo === "string" ? exitOutput.switchedTo : undefined,
        message: typeof exitOutput?.message === "string" ? exitOutput.message : undefined,
      };
    }
    default:
      return null;
  }
}
