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
 */
export const ChatMessages = ({ messages, thinkingTimes }: ChatMessagesProps) => {
  const { lastAskKey, lastPlanWriteKey, userAfter } = messageFlags(messages);

  return messages.flatMap((m, mi) =>
    m.parts.map((part, i) => {
      if (m.role === "user" && part.type === "text") {
        return <UserMessage key={`${m.id}-${i}`} text={part.text} />;
      } else if (m.role === "assistant") {
        switch (part.type) {
          case "text":
            return <AssistantMessage key={`${m.id}-${i}`} markdown={part.text} isStreaming={part.state === "streaming"} />;
          case "reasoning":
            return <ThinkingMessage key={`${m.id}-${i}`} markdown={part.text} isStreaming={part.state === "streaming"} time={thinkingTimes[thinkingPartKey(m.id, i, part.id)] ?? 0} />;
          default: {
            const name = toolNameOf(part as ToolPart);
            const key = `${m.id}-${name}-${i}`;
            const tool = toolPartToModel(part as ToolPart, {
              partKey: key,
              isPendingAsk: name === "ask" && key === lastAskKey,
              isPendingPlanWrite: name === "plan-write" && key === lastPlanWriteKey,
              hasFollowingUserMessage: userAfter[mi],
            });
            if (tool) return <ToolCall key={key} model={tool} copyText={partCopyText(part)} />;
            break;
          }
        }
      }
      return null;
    }),
  );
};