import { useSelector } from "@xstate/store-react";
import { useMemo } from "react";
import { useTheme } from "../hooks/useTheme";
import { loopStore } from "../stores/loop-store";
import { useLoopKeybinds } from "../hooks/useLoopKeybinds";
import { resolveModel } from "../harness/agent/factory/provider-resolver";
import type { ResolvedModel } from "../harness/agent/factory/provider-resolver";
import { getAgent } from "../harness/agent/factory/agent/registry";
import { resolveAgentColor } from "../harness/agent/factory/agent/color";
import { ChatMessages } from "../components/session/ChatMessages";
import { Prompt } from "../components/session/Prompt";
import { ModelPicker } from "../components/session/pickers/ModelPicker";
import { CommandPicker } from "../components/session/pickers/CommandPicker";
import { EffortPicker } from "../components/session/pickers/EffortPicker";
import { ModelStatusBar } from "../components/session/status-bars/ModelStatusBar";
import { ThinkingIndicator } from "../components/session/ThinkingIndicator";
import { ErrorMessage } from "../components/session/ErrorMessage";
import { SessionTabs, type CodingTabId } from "../components/layout/Tabs";
import { useSession } from "../hooks/useSession";
import { usePersistentSession } from "../hooks/usePersistentSession";
import { TopStatusBar } from "../components/session/status-bars/TopStatusBar";
import { SessionsPicker } from "../components/session/pickers/SessionsPicker";
import { ContactsPicker } from "../components/session/pickers/ContactsPicker";
import { AuthPicker } from "../components/session/pickers/AuthPicker";
import { AuthStatusDialog } from "../components/dialogs/AuthStatusDialog";
import { ModelRolesPicker } from "../components/session/pickers/ModelRolesPicker";
import { DirectoryPicker } from "../components/session/pickers/DirectoryPicker";
import { FilePicker } from "../components/session/pickers/FilePicker";
import { sessionTitleStore } from "../stores/session-title-store";

export type SessionPageProps = {
  sessionTab: CodingTabId;
  onCodingTabChange: (tab: CodingTabId) => void;
};

export const SessionPage = ({ sessionTab, onCodingTabChange }: SessionPageProps) => {
  const { theme } = useTheme();
  const agentId = useSelector(loopStore, (s) => s.context.agentId);
  const modelKey = useSelector(loopStore, (s) => s.context.modelKey);
  const thinking = useSelector(loopStore, (s) => s.context.thinking);
  const modelPickerOpen = useSelector(loopStore, (s) => s.context.modelPickerOpen);
  const commandOpen = useSelector(loopStore, (s) => s.context.commandOpen);
  const effortOpen = useSelector(loopStore, (s) => s.context.effortOpen);
  const sessionsOpen = useSelector(loopStore, (s) => s.context.sessionsOpen);
  const contactsOpen = useSelector(loopStore, (s) => s.context.contactsOpen);
  const authPickerOpen = useSelector(loopStore, (s) => s.context.authPickerOpen);
  const rolePickerOpen = useSelector(loopStore, (s) => s.context.rolePickerOpen);
  const cwdPickerOpen = useSelector(loopStore, (s) => s.context.cwdPickerOpen);
  const filePickerOpen = useSelector(loopStore, (s) => s.context.filePickerOpen);

  const chat = useSession();
  const persistent = usePersistentSession();
  // One tab body is mounted at a time, so the active session drives the keybinds
  // (ESC ESC interrupt) and the status bar. Agent cycling only visits agents of
  // the active tab's category.
  const active = sessionTab === "coding" ? chat : persistent;
  const agentCategory = sessionTab === "coding" ? "coding" : "persistent";

  useLoopKeybinds(active.streaming, active.stop, agentCategory);

  // The generated session title for the active mode (SESSION_TITLE slot).
  const sessionTitle = useSelector(sessionTitleStore, (s) =>
    sessionTab === "coding" ? s.context.coding : s.context.persistent,
  );

  const resolvedModel = useMemo<ResolvedModel | null>(() => {
    try {
      return resolveModel(modelKey);
    } catch {
      // E.g. a logout left the active model dangling, or no provider/auth is
      // configured yet. The status bar degrades instead of crashing the page.
      return null;
    }
  }, [modelKey]);
  const agent = useMemo(
    () => (sessionTab === "coding" ? getAgent(agentId) : getAgent("persistent")),
    [sessionTab, agentId],
  );
  const agentName = agent.name;
  const agentColor = useMemo(() => resolveAgentColor(agent, theme), [agent, theme]);

  return (
    <box id="sessions-page" flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        {sessionTab === 'coding' ? <TopStatusBar /> : <text></text>}
        <text fg={theme.secondary}>{sessionTitle ?? ""}</text>
        <SessionTabs current={sessionTab} onChange={onCodingTabChange} />
      </box>
      <scrollbox
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        marginTop={1}
        scrollY
        overflow="hidden"
        stickyScroll
        stickyStart="bottom"
        contentOptions={{ justifyContent: 'flex-end', gap: 1 }}>
        <ChatMessages messages={active.messages} thinkingTimes={active.thinkingTimes} />
      </scrollbox>
      <box flexDirection="column" marginTop={1}>
        {active.streaming && <ThinkingIndicator />}
        {!active.streaming && active.error && <ErrorMessage report={active.error} />}
        {modelPickerOpen && <ModelPicker />}
        {commandOpen && <CommandPicker kind={agentCategory} />}
        {effortOpen && <EffortPicker />}
        {sessionsOpen && <SessionsPicker />}
        {contactsOpen && <ContactsPicker />}
        {authPickerOpen && <AuthPicker />}
        {rolePickerOpen && <ModelRolesPicker />}
        {cwdPickerOpen && <DirectoryPicker />}
        {filePickerOpen && <FilePicker />}
        <AuthStatusDialog />
        <Prompt onSubmit={active.onPrompt} kind={agentCategory} />
        <ModelStatusBar
          agentName={agentName}
          agentColor={agentColor}
          resolvedModel={resolvedModel}
          thinking={thinking}
          inputTokens={active.inputTokens}
          outputTokens={active.outputTokens}
          cacheReadTokens={active.cacheReadTokens}
          cacheWriteTokens={active.cacheWriteTokens}
          cost={active.cost}
          elapsedSec={active.elapsedSec}
          ttftMs={active.ttftMs}
          tokensPerSec={active.tokensPerSec}
        />
      </box>
    </box>
  );
};
