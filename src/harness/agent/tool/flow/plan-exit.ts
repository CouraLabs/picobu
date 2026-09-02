import z from "zod";
import { loopStore } from "../../../../stores/loop-store";

export const PlanExitToolArgsSchema = z.object({});

export const PlanExitToolOutputSchema = z.object({
  switchedTo: z.string(),
  message: z.string(),
});

/**
 * Plan → Coder handoff flow tool. Switches the active agent exactly like a
 * manual picker change (tab): the global picker flips to Coder and the agent's
 * bound model role config applies. Because the loop's `prepareCall` re-resolves
 * the active agent from the live config on every step, the very next loop step
 * runs as the Coder agent with the full toolset, and the handoff message below
 * lands in context as the instruction to start implementing. Call only after
 * the user explicitly accepted the plan.
 */
export const createPlanExitTool = () => ({
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
    // Same state transition as the TAB keybind: the global picker visibly
    // shows Coder and the agent's model role config applies from the next step.
    loopStore.trigger.setAgent({ agentId: "coder" });
    return {
      switchedTo: "coder",
      message:
        "Plan approved. Switched from Plan to Coder — implement the approved plan now, starting with the first phase.",
    };
  },
});
