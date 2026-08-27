import { ReadToolCall } from "./tools/ReadToolCall";
import { EditToolCall } from "./tools/EditToolCall";
import { WriteToolCall } from "./tools/WriteToolCall";
import { BashToolCall } from "./tools/BashToolCall";
import { GrepToolCall } from "./tools/GrepToolCall";
import { GlobToolCall } from "./tools/GlobToolCall";
import type { ToolCallModel } from "./types";

/** Compile-time exhaustiveness guard for `ToolCallModel` (asserted `never`). */
const assertNever = (value: never): never => {
  throw new Error(`Unreachable tool call: ${String(value)}`);
};

export type ToolCallProps = {
  model: ToolCallModel;
};

/** Dispatch a tool call to its variant renderer based on the tool name. */
export const ToolCall = ({ model }: ToolCallProps) => {
  switch (model.name) {
    case "read":
      return <ReadToolCall {...model} />;
    case "edit":
      return <EditToolCall {...model} />;
    case "write":
      return <WriteToolCall {...model} />;
    case "bash":
      return <BashToolCall {...model} />;
    case "grep":
      return <GrepToolCall {...model} />;
    case "glob":
      return <GlobToolCall {...model} />;
    default: {
      // Exhaustiveness guard: the `ToolCallModel` union is closed over exactly
      // the cases above; `toolPartToModel` returns `null` for anything else, so
      // a default here is unreachable by construction.
      return assertNever(model);
    }
  }
};