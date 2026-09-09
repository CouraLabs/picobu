import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { buildCommandPrompt } from "@agent/commands/discovery.ts";
import { listCommands } from "@agent/commands/index.ts";
import { parseCommandLine, type ParsedCommandLine } from "@agent/commands/parse-command-line.ts";
import type { LoopMessage } from "@agent/loop/create-loop.ts";
import { generateSessionTitle } from "@agent/prompts/session-title.ts";
import type { Session } from "@agent/sessions/session.ts";
import { SessionManager } from "@agent/sessions/session-manager.ts";
import type { SessionTotals } from "@agent/sessions/session-meta.ts";
import { isWaiting } from "@agent/sessions/session-meta.ts";
import type { ProviderModelReasoningEffort } from "@config/options.ts";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { getGitInfo } from "@shared/git-info.ts";
import { notifyCompletion, notifyFailure } from "@shared/notify.ts";
import { closeDialog, dialogStatus, openDialog } from "@states/dialog.state.ts";
import { flushThemeSave, theme } from "@states/theme-state.ts";
import { openJobsDialog } from "@tui/components/session/jobs-dialog.tsx";
import { openMessageActions } from "@tui/components/session/message-actions.tsx";
import { ModelSelect } from "@tui/components/session/model-select.tsx";
import { openRolesDialog } from "@tui/components/session/roles-dialog.tsx";
import { SessionMessages } from "@tui/components/session/session-messages.tsx";
import { type PromptMode, SessionPrompt } from "@tui/components/session/session-prompt.tsx";
import { SessionStatus, THINKING_LEVELS } from "@tui/components/session/session-status.tsx";
import { openSubagentMessages } from "@tui/components/session/subagent-dialog.tsx";
import type { ToolFlowResponse } from "@tui/components/session/tools/tool-part.tsx";
import { markActiveSessionHasMessages, setActiveSessionId } from "@tui/hooks/active-session.ts";
import { createSignal, onCleanup, onMount } from "solid-js";

export type SessionPageProps = {
  sessionId?: string;
  visible: boolean;
};

const AGENT_CYCLE = ["ask", "coder", "plan-code"];

const ESC_WINDOW_MS = 600;

const showError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  openDialog(() => (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg={theme().error}>Something went wrong</text>
      <text fg={theme().text}>{message}</text>
      <text fg={theme().textMuted}>(esc to close)</text>
    </box>
  ));
};

const showInfo = (title: string, body: string) => {
  openDialog(() => (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg={theme().text}>{title}</text>
      <text fg={theme().text}>{body}</text>
      <text fg={theme().textMuted}>(esc to close)</text>
    </box>
  ));
};

type LooseFlowPart = {
  type?: unknown;
  toolName?: unknown;
  toolCallId?: unknown;
  output?: unknown;
};

const pendingFlowPart = (parts: unknown[]): { tool: "ask" | "plan-write"; toolCallId: string } | undefined => {
  for (const raw of parts) {
    const part = raw as LooseFlowPart;
    const name =
      part.type === "dynamic-tool" ? part.toolName : typeof part.type === "string" && part.type.startsWith("tool-") ? part.type.slice("tool-".length) : undefined;
    if (name !== "ask" && name !== "plan-write") continue;
    const output = part.output as { status?: unknown } | undefined;
    if (typeof part.toolCallId !== "string" || part.toolCallId.length === 0) continue;
    if (!output || output.status !== "pending") continue;
    return { tool: name, toolCallId: part.toolCallId };
  }
  return undefined;
};

export const SessionPage = (props: SessionPageProps) => {
  const [session, setSession] = createSignal<Session | undefined>(undefined);
  const [messages, setMessages] = createSignal<LoopMessage[]>([]);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [waiting, setWaiting] = createSignal(false);
  const [answering, setAnswering] = createSignal(false);
  const [activeId, setActiveId] = createSignal<string | undefined>(props.sessionId);
  const [agentId, setAgentId] = createSignal<string | undefined>(undefined);
  const [modelKey, setModelKey] = createSignal<string | undefined>(undefined);
  const [thinking, setThinking] = createSignal<ProviderModelReasoningEffort | undefined>(undefined);
  const [title, setTitle] = createSignal<string | undefined>(undefined);
  const [totals, setTotals] = createSignal<SessionTotals | undefined>(undefined);
  const [cwd, setCwd] = createSignal<string | undefined>(undefined);
  const [git, setGit] = createSignal<{ branch: string; additions: number; deletions: number } | null>(null);
  const [mode, setMode] = createSignal<PromptMode>("normal");
  const [queueDepth, setQueueDepth] = createSignal(0);
  const [commandOpen, setCommandOpen] = createSignal(false);
  const [commandExitNonce, setCommandExitNonce] = createSignal(0);
  const sessionMgr = new SessionManager();
  const renderer = useRenderer();
  let lastEsc = 0;
  let prevStreaming = false;
  let prevWaiting = false;

  const refreshGit = (dir: string | undefined) => {
    setCwd(dir);
    setGit(dir ? getGitInfo(dir) : null);
  };

  const attachSession = (next: Session) => {
    setSession(next);
    setActiveId(next.id);
    setAgentId(next.config.agentId);
    setModelKey(next.config.modelKey);
    setThinking(next.config.thinking);
    setTitle(next.title);
    setTotals({ ...next.totals });
    setMessages([...next.messages]);
    setQueueDepth(next.queuedCount);
    setActiveSessionId(next.id);
    if (next.messages.length > 0) markActiveSessionHasMessages();
    const streaming = next.status === "submitted" || next.status === "streaming";
    const w = isWaiting(next.messages);
    setIsStreaming(streaming);
    setWaiting(w);
    prevStreaming = streaming;
    prevWaiting = w;
    refreshGit(next.config.cwd ?? sessionMgr.currentCwd);
  };

  const openModelDialog = () => {
    const target = session();
    if (!target) return;
    openDialog(() => (
      <ModelSelect
        currentModelKey={modelKey()}
        onSelect={(selected) => {
          try {
            target.switchModel(selected);
          } catch (error) {
            showError(error);
            return;
          }
          setModelKey(selected);
          closeDialog();
        }}
      />
    ));
  };

  const cancelPendingFlow = async () => {
    const msgs = messages();
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== "assistant") return;
    const found = pendingFlowPart(last.parts as unknown[]);
    if (!found) return;
    if (found.tool === "ask") {
      await handleFlowResponse({
        tool: "ask",
        toolCallId: found.toolCallId,
        output: { status: "cancelled", message: "The user dismissed the questions without answering" },
      });
    } else {
      await handleFlowResponse({
        tool: "plan-write",
        toolCallId: found.toolCallId,
        output: { status: "cancelled", message: "The user dismissed the plan review" },
      });
    }
  };

  const interruptStack = async () => {
    const target = session();
    if (!target) return;
    if (isWaiting(messages())) {
      try {
        await cancelPendingFlow();
      } catch (error) {
        showError(error);
      }
      return;
    }
    if (target.queuedCount > 0) {
      target.dequeueNewest();
      setQueueDepth(target.queuedCount);
      return;
    }
    if (target.status === "submitted" || target.status === "streaming") {
      try {
        await target.stop();
      } catch (error) {
        showError(error);
      }
    }
  };

  useKeyboard((key) => {
    if (dialogStatus().status === "open") return;
    const target = session();
    if (!target) return;

    if (key.name === "escape") {
      if (commandOpen()) {
        setCommandExitNonce((n) => n + 1);
        lastEsc = 0;
        return;
      }
      const now = Date.now();
      if (now - lastEsc < ESC_WINDOW_MS) {
        lastEsc = 0;
        key.preventDefault();
        void interruptStack();
      } else {
        lastEsc = now;
      }
      return;
    }
    if (key.ctrl && key.name === "q") {
      key.preventDefault();
      setMode((m) => (m === "queue" ? "normal" : "queue"));
      return;
    }
    if (key.ctrl && key.name === "w") {
      key.preventDefault();
      setMode((m) => (m === "steer" ? "normal" : "steer"));
      return;
    }
    if (key.ctrl && key.name === "j") {
      key.preventDefault();
      openJobsDialog({
        manager: sessionMgr,
        onOpenSession: (id, label) => openSubagentMessages({ manager: sessionMgr, sessionId: id, label }),
      });
      return;
    }
    if (key.name === "tab" && !key.shift) {
      if (commandOpen()) return;
      key.preventDefault();
      try {
        const current = AGENT_CYCLE.indexOf(agentId() ?? target.config.agentId);
        const next = AGENT_CYCLE[(current + 1) % AGENT_CYCLE.length] ?? AGENT_CYCLE[0]!;
        target.switchAgent(next);
        setAgentId(next);
      } catch (error) {
        showError(error);
      }
      return;
    }
    if (key.name === "tab" && key.shift) {
      key.preventDefault();
      try {
        const current = THINKING_LEVELS.indexOf(thinking() as (typeof THINKING_LEVELS)[number]);
        const len = THINKING_LEVELS.length;
        const next = THINKING_LEVELS[current < 0 ? len - 1 : (current - 1 + len) % len] ?? THINKING_LEVELS[0]!;
        target.switchThinking(next);
        setThinking(next);
      } catch (error) {
        showError(error);
      }
      return;
    }
    if (key.ctrl && key.name === "m") {
      key.preventDefault();
      openModelDialog();
    }
  });

  onMount(() => {
    void openSession(activeId());
    onCleanup(() => {
      session()?.close();
    });
  });

  const openSession = async (id?: string) => {
    try {
      const next = await sessionMgr.startSession({
        id,
        onChange: (state) => {
          setMessages([...state.messages]);
          const streaming = state.status === "submitted" || state.status === "streaming";
          setIsStreaming(streaming);
          if (streaming || state.status === "error") setAnswering(false);
          const w = isWaiting(state.messages);
          setWaiting(w);
          if (state.messages.length > 0) markActiveSessionHasMessages();
          const live = session();
          if (live) {
            setTitle(live.title);
            setQueueDepth(live.queuedCount);
            setTotals({ ...live.totals });
          }
          const current = session();
          refreshGit(current?.config.cwd ?? sessionMgr.currentCwd);
          if (!prevWaiting && w) notifyCompletion("Input needed — review the question above");
          if (prevStreaming && !streaming) {
            if (state.error) notifyFailure(state.error.message);
            else notifyCompletion("Run complete");
          }
          prevStreaming = streaming;
          prevWaiting = w;
        },
      });
      attachSession(next);
    } catch (error) {
      showError(error);
    }
  };

  const refreshTitle = (promptText: string, target: Session) => {
    generateSessionTitle(promptText)
      .then((generated) => {
        if (session()?.id !== target.id) return;
        target.setTitle(generated);
        setTitle(generated);
      })
      .catch(() => {});
  };

  const quitApp = async () => {
    const target = session();
    try {
      await target?.flush();
    } catch {}
    try {
      await flushThemeSave();
    } catch {}
    try {
      renderer.destroy();
    } catch {
      process.exit(0);
    }
  };

  const handleCd = async (arg: string, target: Session) => {
    const raw = arg.trim();
    if (!raw) {
      showError(new Error("Usage: /cd <path>"));
      return;
    }
    const base = target.config.cwd ?? sessionMgr.currentCwd;
    const next = resolve(base, raw);
    const info = await stat(next).catch(() => undefined);
    if (!info?.isDirectory()) {
      showError(new Error(`Not a directory: ${next}`));
      return;
    }
    try {
      try {
        await target.flush();
      } catch {}
      const fresh = await sessionMgr.changeDirectory(next);
      if (!fresh) return;
      attachSession(fresh);
    } catch (error) {
      showError(error);
    }
  };

  const handleNewSession = async (target: Session) => {
    try {
      try {
        await target.flush();
      } catch {}
      await target.close();
      setSession(undefined);
      setMessages([]);
      setIsStreaming(false);
      setWaiting(false);
      setAnswering(false);
      await openSession(undefined);
    } catch (error) {
      showError(error);
    }
  };

  const dispatchCommand = async (line: string, target: Session) => {
    let parsed: ParsedCommandLine | null;
    try {
      parsed = parseCommandLine(line.trim(), listCommands());
    } catch (error) {
      showError(error);
      return;
    }
    if (!parsed || parsed.kind === "unknown") {
      showError(new Error(`Unknown command "${line.trim().split(/\s+/)[0]}"`));
      return;
    }
    if (parsed.kind === "skills") {
      const literal = line.trim();
      if (waiting() || answering() || target.status === "submitted" || target.status === "streaming") {
        try {
          target.queue(literal);
        } catch (error) {
          showError(error);
          return;
        }
        setQueueDepth(target.queuedCount);
      } else {
        try {
          await target.sendMessage({ parts: [{ type: "text", text: literal }] });
        } catch (error) {
          showError(error);
        }
        if (target.error) showError(target.error);
      }
      refreshTitle(parsed.prompt || literal, target);
      return;
    }
    if (parsed.kind === "workflow") {
      let prompt: string;
      try {
        prompt = await buildCommandPrompt(parsed.command, parsed.args);
      } catch (error) {
        showError(error);
        return;
      }
      if (waiting() || answering() || target.status === "submitted" || target.status === "streaming") {
        try {
          target.queue(prompt);
        } catch (error) {
          showError(error);
          return;
        }
        setQueueDepth(target.queuedCount);
      } else {
        try {
          await target.sendMessage({ parts: [{ type: "text", text: prompt }] });
        } catch (error) {
          showError(error);
        }
        if (target.error) showError(target.error);
      }
      refreshTitle(parsed.args || parsed.command.name, target);
      return;
    }
    switch (parsed.command.name) {
      case "q":
        await quitApp();
        break;
      case "compact":
        try {
          await target.compact();
        } catch (error) {
          showError(error);
        }
        break;
      case "models":
        openModelDialog();
        break;
      case "fork": {
        if (target.status === "submitted" || target.status === "streaming" || isWaiting(target.messages)) {
          showError(new Error("Cannot fork while a run is in progress"));
          break;
        }
        const last = target.messages[target.messages.length - 1];
        if (!last) {
          showError(new Error("Nothing to fork yet"));
          break;
        }
        await handleFork(last.id);
        break;
      }
      case "summarize": {
        if (target.status === "submitted" || target.status === "streaming") {
          showError(new Error("Cannot summarize while a run is in progress"));
          break;
        }
        try {
          const result = await target.summarize();
          showInfo("Summary", result.summary);
        } catch (error) {
          showError(error);
        }
        break;
      }
      case "roles":
        openRolesDialog();
        break;
      case "cd":
        await handleCd(parsed.args, target);
        break;
      case "new":
        await handleNewSession(target);
        break;
    }
  };

  const handlePrompt = async (text: string) => {
    const target = session();
    if (!target) {
      showError(new Error("Session is not ready yet, please try again"));
      return;
    }
    if (text.startsWith("/")) {
      await dispatchCommand(text, target);
      return;
    }
    if (mode() === "queue") {
      try {
        target.queue(text);
      } catch (error) {
        showError(error);
        return;
      }
      setQueueDepth(target.queuedCount);
      refreshTitle(text, target);
      return;
    }
    if (mode() === "steer") {
      try {
        await target.steer(text);
      } catch (error) {
        showError(error);
        return;
      }
      setQueueDepth(target.queuedCount);
      refreshTitle(text, target);
      return;
    }
    if (waiting() || answering()) {
      try {
        target.queue(text);
      } catch (error) {
        showError(error);
        return;
      }
      setQueueDepth(target.queuedCount);
      refreshTitle(text, target);
      return;
    }
    if (target.status === "submitted" || target.status === "streaming") {
      target.queue(text);
      setQueueDepth(target.queuedCount);
      refreshTitle(text, target);
      return;
    }
    try {
      await target.sendMessage({ parts: [{ type: "text", text }] });
    } catch (error) {
      showError(error);
    }
    setQueueDepth(target.queuedCount);
    if (target.error) showError(target.error);
    refreshTitle(text, target);
  };

  const handleFlowResponse = async (response: ToolFlowResponse) => {
    const target = session();
    if (!target) {
      showError(new Error("Session is not ready yet, please try again"));
      return;
    }
    setAnswering(true);
    try {
      if (response.tool === "plan-write" && response.output.status === "approved") {
        target.setPlanHandoffCompact(response.compact !== false);
      }
      await target.respondFlowTool({
        tool: response.tool,
        toolCallId: response.toolCallId,
        output: response.output,
      });
    } catch (error) {
      showError(error);
      throw error;
    } finally {
      setAnswering(false);
    }
    if (target.error) showError(target.error);
  };

  const handleRevert = (messageId: string) => {
    const target = session();
    if (!target) {
      showError(new Error("Session is not ready yet, please try again"));
      return;
    }
    try {
      target.revertToMessage(messageId);
      closeDialog();
    } catch (error) {
      showError(error);
    }
  };

  const handleFork = async (messageId: string) => {
    const target = session();
    if (!target) {
      showError(new Error("Session is not ready yet, please try again"));
      return;
    }
    try {
      const { sessionId: forkId } = await sessionMgr.forkSession(target.id, { upToMessageId: messageId });
      closeDialog();
      await target.close();
      setSession(undefined);
      setMessages([]);
      setIsStreaming(false);
      setWaiting(false);
      setAnswering(false);
      await openSession(forkId);
    } catch (error) {
      showError(error);
    }
  };

  return (
    <box flexDirection="row" flexGrow={1} flexShrink={1} visible={props.visible}>
      <box flexDirection="column" flexGrow={1} flexShrink={1}>
        <SessionMessages
          messages={messages()}
          isStreaming={isStreaming()}
          onFlowResponse={handleFlowResponse}
          onMessageOpen={(message) => openMessageActions({ message, onRevert: handleRevert, onFork: (id) => void handleFork(id) })}
          onOpenSubSession={(id, label) => openSubagentMessages({ manager: sessionMgr, sessionId: id, label })}
        />
        <SessionPrompt
          onPrompt={handlePrompt}
          streaming={isStreaming()}
          waiting={waiting() || answering()}
          mode={mode()}
          queueDepth={queueDepth()}
          onCommandOpenChange={setCommandOpen}
          commandExitNonce={commandExitNonce()}
        />
        <SessionStatus
          agentId={agentId()}
          modelKey={modelKey()}
          thinking={thinking()}
          title={title()}
          cwd={cwd()}
          git={git()}
          messages={messages()}
          totals={totals()}
          streaming={isStreaming()}
        />
      </box>
    </box>
  );
};
