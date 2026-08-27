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

export const ChatMessages = ({ messages, thinkingTimes }: ChatMessagesProps) =>
  messages.flatMap((m) =>
    m.parts.map((part, i) => {
      if (m.role === "user" && part.type === "text") {
        return <UserMessage key={`${m.id}-${i}`} text={part.text} />;
      } else if (m.role === "assistant") {
        switch (part.type) {
          case "text":
            return <AssistantMessage key={`${m.id}-${i}`} markdown={part.text} isStreaming={part.state === "streaming"} />;
          case "reasoning":
            return <ThinkingMessage key={`${m.id}-${i}`} markdown={part.text} isStreaming={part.state === "streaming"} time={thinkingTimes[thinkingPartKey(m.id, i, part.id)] ?? 0} />;
          default:
            const tool = toolPartToModel(part as ToolPart);
            if (tool) return <ToolCall key={`${m.id}-${tool.name}-${i}`} model={tool} copyText={partCopyText(part)} />;
            break;
        }
      }
      return null;
    }),
  );