import { ReadToolCall, type ReadToolCallProps } from "./tools/ReadToolCall";
import { EditToolCall, type EditToolCallProps } from "./tools/EditToolCall";
import { WriteToolCall, type WriteToolCallProps } from "./tools/WriteToolCall";
import { BashToolCall, type BashToolCallProps } from "./tools/BashToolCall";
import { GrepToolCall, type GrepToolCallProps } from "./tools/GrepToolCall";
import { GlobToolCall, type GlobToolCallProps } from "./tools/GlobToolCall";
import { TodoToolCall, type TodoToolCallProps } from "./tools/TodoToolCall";
import { WebsearchToolCall, type WebsearchToolCallProps } from "./tools/WebsearchToolCall";
import { WebfetchToolCall, type WebfetchToolCallProps } from "./tools/WebfetchToolCall";
import { WwpToolCall, type WwpToolCallProps } from "./tools/WwpToolCall";
import { AskToolCall, type AskToolCallProps } from "./tools/AskToolCall";
import { PlanExitToolCall, type PlanExitToolCallProps } from "./tools/PlanExitToolCall";
import { PlanWriteToolCall, type PlanWriteToolCallProps } from "./tools/PlanWriteToolCall";
import { SkillToolCall, type SkillToolCallProps } from "./tools/SkillToolCall";

export type ToolStatus = "success" | "error" | "running";

/** Discriminated union of every tool call the coding page can render. */
export type ToolCallModel =
  | ({ name: "read" } & ReadToolCallProps)
  | ({ name: "edit" } & EditToolCallProps)
  | ({ name: "write" } & WriteToolCallProps)
  | ({ name: "bash" } & BashToolCallProps)
  | ({ name: "grep" } & GrepToolCallProps)
  | ({ name: "glob" } & GlobToolCallProps)
  | ({ name: "todo" } & TodoToolCallProps)
  | ({ name: "websearch" } & WebsearchToolCallProps)
  | ({ name: "webfetch" } & WebfetchToolCallProps)
  | ({ name: "wwp"; tool: string; summary: string; status: ToolStatus; error?: string; output?: string })
  | ({ name: "ask" } & AskToolCallProps)
  | ({ name: "plan-exit" } & PlanExitToolCallProps)
  | ({ name: "plan-write" } & PlanWriteToolCallProps)
  | ({ name: "skill" } & SkillToolCallProps);

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
    case "todo":
      return <TodoToolCall {...model} copyText={copyText} />;
    case "websearch":
      return <WebsearchToolCall {...model} copyText={copyText} />;
    case "webfetch":
      return <WebfetchToolCall {...model} copyText={copyText} />;
    case "wwp":
      return <WwpToolCall {...model} copyText={copyText} />;
    case "ask":
      return <AskToolCall {...model} copyText={copyText} />;
    case "plan-exit":
      return <PlanExitToolCall {...model} copyText={copyText} />;
    case "plan-write":
      return <PlanWriteToolCall {...model} copyText={copyText} />;
    case "skill":
      return <SkillToolCall {...model} copyText={copyText} />;
    default: {
      // Exhaustiveness guard: the `ToolCallModel` union is closed over exactly
      // the cases above; `toolPartToModel` returns `null` for anything else, so
      // a default here is unreachable by construction.
      return assertNever(model);
    }
  }
};