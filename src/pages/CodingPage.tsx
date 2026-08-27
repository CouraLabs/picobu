import { useSelector } from "@xstate/store-react";
import { useMemo } from "react";
import { themeStore } from "../stores/theme-store";
import { loopStore } from "../stores/loop-store";
import { useLoopKeybinds } from "../hooks/useLoopKeybinds";
import { resolveModel } from "../harness/agent/factory/provider-resolver";
import { getAgent } from "../harness/agent/factory/agent/registry";
import { resolveAgentColor } from "../harness/agent/factory/agent/color";
import { ChatMessages } from "../components/coding/ChatMessages";
import { Prompt } from "../components/coding/Prompt";
import { ModelPicker } from "../components/coding/ModelPicker";
import { CommandPicker } from "../components/coding/CommandPicker";
import { EffortPicker } from "../components/coding/EffortPicker";
import { ModelStatusBar } from "../components/coding/ModelStatusBar";
import { useCodingSession } from "../components/coding/session";

export const CodingPage = ({ sessionId }: { sessionId?: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const { agentId, modelKey, thinking, modelPickerOpen, commandOpen, effortOpen } =
    useSelector(loopStore, (s) => s.context);

  const { messages, streaming, onPrompt, elapsedSec, ttftMs, thinkingMs, tokensPerSec, inputTokens, outputTokens, cacheTokens } = useCodingSession();

  useLoopKeybinds(streaming);

  const resolvedModel = useMemo(() => resolveModel(modelKey), [modelKey]);
  const agent = useMemo(() => getAgent(agentId), [agentId]);
  const agentName = agent.name;
  const agentColor = useMemo(() => resolveAgentColor(agent, theme), [agent, theme]);

  return (
    <box id="coding-page" flexDirection="column" paddingX={1}>
      <scrollbox
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        scrollY
        overflow="hidden"
        stickyScroll
        stickyStart="bottom"
        contentOptions={{ justifyContent: 'flex-end', gap: 1 }}>
        <ChatMessages messages={messages} thinkingMs={thinkingMs} />
      </scrollbox>
      <box flexDirection="column" marginTop={1}>
        {streaming && (
          <box flexDirection="row" gap={1} marginLeft={1}>
            <spinner name="dots" color={theme.accent} />
            <text fg={theme.textMuted}>Thinking...</text>
          </box>
        )}
        {modelPickerOpen && <ModelPicker />}
        {commandOpen && <CommandPicker />}
        {effortOpen && <EffortPicker />}
        <Prompt onSubmit={onPrompt} />
        <ModelStatusBar
          agentName={agentName}
          agentColor={agentColor}
          resolvedModel={resolvedModel}
          thinking={thinking}
          inputTokens={inputTokens}
          outputTokens={outputTokens}
          cacheTokens={cacheTokens}
          elapsedSec={elapsedSec}
          ttftMs={ttftMs}
          tokensPerSec={tokensPerSec}
        />
      </box>
    </box>
  );
};