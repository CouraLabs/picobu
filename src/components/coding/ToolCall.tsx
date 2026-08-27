import { ReadToolCall, type ReadToolCallProps } from "./tools/ReadToolCall";
import { EditToolCall, type EditToolCallProps } from "./tools/EditToolCall";
import { WriteToolCall, type WriteToolCallProps } from "./tools/WriteToolCall";
import { BashToolCall, type BashToolCallProps } from "./tools/BashToolCall";
import { GrepToolCall, type GrepToolCallProps } from "./tools/GrepToolCall";
import { GlobToolCall, type GlobToolCallProps } from "./tools/GlobToolCall";

export type ToolStatus = "success" | "error";

/** Discriminated union of every tool call the coding page can render. */
export type ToolCallModel =
  | ({ name: "read" } & ReadToolCallProps)
  | ({ name: "edit" } & EditToolCallProps)
  | ({ name: "write" } & WriteToolCallProps)
  | ({ name: "bash" } & BashToolCallProps)
  | ({ name: "grep" } & GrepToolCallProps)
  | ({ name: "glob" } & GlobToolCallProps);

/** Compile-time exhaustiveness guard for `ToolCallModel` (asserted `never`). */
const assertNever = (value: never): never => {
  throw new Error(`Unreachable tool call: ${String(value)}`);
};

export type ToolCallProps = {
  model: ToolCallModel;
  /** Raw message content copied when the tool body is clicked. */
  copyText: string;
};

/** Dispatch a tool call to its variant renderer based on the tool name. */
export const ToolCall = ({ model, copyText }: ToolCallProps) => {
  switch (model.name) {
    case "read":
      return <ReadToolCall {...model} copyText={copyText} />;
    case "edit":
      return <EditToolCall {...model} copyText={copyText} />;
    case "write":
      return <WriteToolCall {...model} copyText={copyText} />;
    case "bash":
      return <BashToolCall {...model} copyText={copyText} />;
    case "grep":
      return <GrepToolCall {...model} copyText={copyText} />;
    case "glob":
      return <GlobToolCall {...model} copyText={copyText} />;
    default: {
      // Exhaustiveness guard: the `ToolCallModel` union is closed over exactly
      // the cases above; `toolPartToModel` returns `null` for anything else, so
      // a default here is unreachable by construction.
      return assertNever(model);
    }
  }
};