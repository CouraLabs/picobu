import z from "zod";
import { agentRoleConfig } from "../../../../../stores/loop-store";
import { getAgentOverride, interactionStore, type AgentOverride } from "../../../../../stores/interaction-store";

export const PlanExitToolArgsSchema = z.object({});

export const PlanExitToolOutputSchema = z.object({
  switchedTo: z.string(),
  message: z.string(),
});

/**
 * Plan → Coder handoff flow tool. Because the loop's `prepareCall` re-resolves
 * the active agent from the live config on every step, writing a per-session
 * agent override here makes the very next loop step run as the Coder agent
 * with the full toolset, and the handoff message below lands in context as the
 * instruction to start implementing. The override is session-scoped so a
 * handoff can never rewrite another session's (or the global) agent picker; it
 * is cleared when the user manually picks an agent again. Call only after the
 * user explicitly accepted the plan.
 */
export const createPlanExitTool = (sessionId: string) => ({
  name: "plan-exit",
  kind: "flow" as const,
  description: [
    "Flow handoff: switch the running loop from the Plan agent to the Coder agent so the approved plan",
    "starts being implemented. Call ONLY after the user has explicitly accepted the plan.",
    "Returns a message instructing the (now Coder) agent to implement the plan.",
  ].join(" "),
  parameters: PlanExitToolArgsSchema,
  output: PlanExitToolOutputSchema,
  handler: (): z.infer<typeof PlanExitToolOutputSchema> => {
    // Invariant: one handoff per session — the override is cleared when the
    // user manually picks an agent, so a second call means stale state.
    if (getAgentOverride(sessionId)) throw new Error("plan-exit was already called for this session");

    // Carry the Coder agent's resolved model role into the override so the
    // implementation run doesn't inherit the Plan agent's heavy model.
    const override: AgentOverride = { agentId: "coder", ...agentRoleConfig("coder") };
    interactionStore.trigger.setAgentOverride({ sessionId, override });
    return {
      switchedTo: "coder",
      message:
        "Plan approved. Switched from Plan to Coder — implement the approved plan now, starting with the first phase.",
    };
  },
});
