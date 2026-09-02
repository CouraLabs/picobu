import { memo, type ReactNode } from "react";
import type { UIMessage } from "ai";
import { AssistantMessage } from "./AssistantMessage";
import { ThinkingMessage } from "./ThinkingMessage";
import { UserMessage } from "./UserMessage";
import { ToolCall } from "./ToolCall";
import { toolPartToModel, type ToolPart } from "../../harness/agent/tool/tool-model-parser";
import { partCopyText } from "../../hooks/useClipboard";
import { thinkingPartKey } from "../../hooks/useRunMetrics";

export type ChatMessagesProps = {
  messages: UIMessage[];
  thinkingTimes: Record<string, number>;
};

const toolNameOf = (part: ToolPart): string =>
  part.type === "dynamic-tool" ? (part.toolName ?? "") : part.type.replace(/^tool-/, "");

/**
 * Per-render derivation for the flow-tool liveness flags, computed in single
 * forward + reverse passes (the naive version re-scans the tail per message).
 */
type MessageFlags = {
  /** Key of the last `ask` part in the list (the live one). */
  lastAskKey: string | null;
  /** Key of the last `plan-write` part in the list (the live one). */
  lastPlanWriteKey: string | null;
  /** Per message index: does a user text message follow it? */
  userAfter: boolean[];
};

const messageFlags = (messages: UIMessage[]): MessageFlags => {
  const userAfter = new Array<boolean>(messages.length).fill(false);
  let sawUser = false;
  for (let mi = messages.length - 1; mi >= 0; mi--) {
    userAfter[mi] = sawUser;
    const m = messages[mi];
    if (m && m.role === "user" && m.parts.some((p) => p.type === "text")) sawUser = true;
  }
  let lastAskKey: string | null = null;
  let lastPlanWriteKey: string | null = null;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    m.parts.forEach((part, i) => {
      if (part.type === "text" || part.type === "reasoning") return;
      const name = toolNameOf(part as ToolPart);
      const key = `${m.id}-${name}-${i}`;
      if (name === "ask") lastAskKey = key;
      else if (name === "plan-write") lastPlanWriteKey = key;
    });
  }
  return { lastAskKey, lastPlanWriteKey, userAfter };
};

/**
 * Message list renderer. Interactive flow tools (`ask`, `plan-write`) are only
 * live while they are the *last* such part in the list AND no user message
 * follows the assistant message containing them (a follow-up means the user
 * already answered/commented). `toolPartToModel` receives those flags.
 *
 * Memoized so metrics-only ticks (tokens/cost/elapsed) don't walk the list;
 * the message components themselves are memoized too, so streaming ticks only
 * re-render the parts whose text actually changed. Consecutive tool calls are
 * wrapped in one column box so the scrollbox gap separates groups, not tools.
 */
export const ChatMessages = memo(({ messages, thinkingTimes }: ChatMessagesProps) => {
  const { lastAskKey, lastPlanWriteKey, userAfter } = messageFlags(messages);

  // Consecutive tool calls are grouped into a single column box so the
  // scrollbox's content `gap: 1` only separates groups (thinking/assistant/
  // user messages) and not individual tool calls within a run.
  const out: ReactNode[] = [];
  let toolRun: ReactNode[] = [];
  let toolRunKey: string | null = null;
  const flushToolRun = () => {
    if (toolRun.length > 0 && toolRunKey) {
      out.push(
        <box key={`tool-group-${toolRunKey}`} flexDirection="column" flexShrink={1}>
          {toolRun}
        </box>,
      );
    }
    toolRun = [];
    toolRunKey = null;
  };

  messages.forEach((m, mi) => {
    m.parts.forEach((part, i) => {
      if (m.role === "user" && part.type === "text") {
        flushToolRun();
        out.push(<UserMessage key={`${m.id}-${i}`} text={part.text} />);
        return;
      }
      if (m.role !== "assistant") return;
      switch (part.type) {
        case "text":
          flushToolRun();
          out.push(<AssistantMessage key={`${m.id}-${i}`} markdown={part.text} isStreaming={part.state === "streaming"} />);
          return;
        case "reasoning":
          flushToolRun();
          out.push(<ThinkingMessage key={`${m.id}-${i}`} markdown={part.text} isStreaming={part.state === "streaming"} time={thinkingTimes[thinkingPartKey(m.id, i, part.id)] ?? 0} />);
          return;
        default: {
          const name = toolNameOf(part as ToolPart);
          const key = `${m.id}-${name}-${i}`;
          const tool = toolPartToModel(part as ToolPart, {
            partKey: key,
            isPendingAsk: name === "ask" && key === lastAskKey,
            isPendingPlanWrite: name === "plan-write" && key === lastPlanWriteKey,
            hasFollowingUserMessage: userAfter[mi],
          });
          if (tool) {
            if (!toolRunKey) toolRunKey = key;
            toolRun.push(<ToolCall key={key} model={tool} copyText={partCopyText(part)} />);
          }
        }
      }
    });
  });
  flushToolRun();

  return out;
});