import { getSubagent, listSubagents, prepareSubagent, SUBAGENT_DEPTH_CAP } from "@agent/agents/subagents.ts";
import type { LoopConfig } from "@agent/loop/create-loop.ts";
import { resolveModelRef } from "@agent/model/resolver.ts";
import { generateSessionTitle } from "@agent/prompts/session-title.ts";
import { createSession, type Session, type SessionPrompt, toPromptMessage } from "@agent/sessions/session.ts";
import type { JobTracker } from "@agent/sessions/session-jobs.ts";
import type { SessionManager } from "@agent/sessions/session-manager.ts";
import { lastAssistantText } from "@agent/sessions/session-messages.ts";
import { generateSessionId } from "@agent/sessions/session-paths.ts";
import { truncate } from "@shared/text-stats.ts";

export type SpawnSubSessionParams = {
  parentId: string;
  subagent: string;
  prompt: SessionPrompt;
  depth: number;
};

export type SpawnContext = {
  manager: SessionManager;
  cwd: string;
  maxAgents: number;
  live: Map<string, Session>;
  jobs: JobTracker;
  baseConfig: (overrides?: {
    agentId?: string;
    modelKey?: string;
    sessionId?: string;
    agentOverride?: LoopConfig["agentOverride"];
    subagent?: boolean;
    spawn?: LoopConfig["spawn"];
  }) => LoopConfig;
};

export async function spawnSubSession(
  ctx: SpawnContext,
  { parentId, subagent, prompt, depth }: SpawnSubSessionParams,
): Promise<{
  sessionId: string;
  summary: string;
  usage: { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; cost?: number };
}> {
  if (ctx.maxAgents <= 0) throw new Error("Spawning is disabled (maxAgents is 0)");
  if (depth >= SUBAGENT_DEPTH_CAP) {
    throw new Error(`Sub agent depth cap of ${SUBAGENT_DEPTH_CAP} reached; report your findings instead of spawning deeper`);
  }
  const def = await getSubagent(subagent, ctx.cwd);
  if (!def) {
    const known = (await listSubagents(ctx.cwd)).map((s) => s.name).join(", ");
    throw new Error(`Unknown subagent "${subagent}". Known subagents: ${known}`);
  }
  const parent = ctx.live.get(parentId);

  const nested = depth > 0;
  if (nested && ctx.jobs.activeSlots >= ctx.maxAgents) {
    throw new Error("Agent concurrency limit reached — wait for the current sub agents to finish, then retry");
  }
  const sessionId = generateSessionId();
  ctx.jobs.set({
    sessionId,
    parentId,
    subagent,
    state: "running",
    queued: !nested,
    startedAt: Date.now(),
  });
  let slotAcquired = false;
  try {
    if (!nested) {
      await ctx.jobs.acquireSlot(ctx.maxAgents);
      slotAcquired = true;
    }
    ctx.jobs.patch(sessionId, { queued: false });
    const prepared = prepareSubagent(def);
    let modelKey = parent?.config.modelKey ?? ctx.baseConfig().modelKey;
    if (def.model) {
      const ref = resolveModelRef(def.model);
      if (`${ref.provider.id}/${ref.modelId}` === def.model) modelKey = def.model;
    }
    const promptText =
      typeof prompt === "string"
        ? prompt
        : Array.isArray((prompt as { parts?: unknown }).parts)
          ? (prompt as { parts: Array<{ type?: unknown; text?: unknown }> }).parts
              .filter((entry) => entry.type === "text" && typeof entry.text === "string")
              .map((entry) => entry.text as string)
              .join("\n")
          : "";
    const fallbackTitle = promptText.trim() ? `${subagent}: ${truncate(promptText.replace(/\s+/g, " ").trim())}` : `${subagent}: sub session`;
    const child = await createSession({
      config: () =>
        ctx.baseConfig({ modelKey, sessionId, agentOverride: prepared, subagent: true, spawn: { manager: ctx.manager, parentId: sessionId, depth: depth + 1 } }),
      id: sessionId,
      meta: { cwd: ctx.cwd, parentSessionId: parentId, title: fallbackTitle },
    });
    ctx.live.set(sessionId, child);
    if (promptText.trim()) {
      generateSessionTitle(promptText)
        .then((generated) => {
          child.setTitle(generated);
        })
        .catch(() => {});
    }
    try {
      await child.sendMessage(toPromptMessage(prompt));
      if (child.error) throw child.error;
      const report = lastAssistantText(child.messages);
      let summary = report;
      if (!summary) {
        const result = await child.summarize().catch(() => undefined);
        if (result) {
          child.addUsage({
            source: "run",
            modelKey,
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            cacheReadTokens: result.usage.cacheReadTokens ?? 0,
            cacheWriteTokens: result.usage.cacheWriteTokens ?? 0,
            cost: result.cost,
          });
        }
        summary = result?.summary ?? "(sub agent produced no output)";
      }
      const childTotals = child.totals;
      parent?.addUsage({
        source: "subagent",
        sessionId,
        subagent,
        modelKey,
        inputTokens: childTotals.inputTokens,
        outputTokens: childTotals.outputTokens,
        cacheReadTokens: childTotals.cacheReadTokens,
        cacheWriteTokens: childTotals.cacheWriteTokens,
        cost: childTotals.cost,
      });
      ctx.jobs.patch(sessionId, { state: "finished" });
      return {
        sessionId,
        summary,
        usage: {
          inputTokens: childTotals.inputTokens,
          outputTokens: childTotals.outputTokens,
          cacheRead: childTotals.cacheReadTokens,
          cacheWrite: childTotals.cacheWriteTokens,
          ...(childTotals.cost !== undefined ? { cost: childTotals.cost } : {}),
        },
      };
    } finally {
      ctx.live.delete(sessionId);
      await child.close().catch(() => {});
    }
  } catch (error) {
    ctx.jobs.patch(sessionId, { state: "error" });
    throw error;
  } finally {
    if (slotAcquired) ctx.jobs.releaseSlot();
  }
}
