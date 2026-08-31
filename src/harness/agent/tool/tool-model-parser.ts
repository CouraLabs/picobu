import type { ToolCallModel, ToolStatus } from "../../../components/session/ToolCall";
import type { TodoItem } from "../../../components/session/tools/TodoToolCall";

export type ToolPart = {
  type: string;
  state?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/** Extract a renderable tool-call model from a tool part, parsing input (args) and output/error. */
export function toolPartToModel(part: ToolPart): ToolCallModel | null {
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
    default:
      return null;
  }
}