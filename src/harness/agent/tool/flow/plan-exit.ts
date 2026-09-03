import z from "zod";

export const PlanExitToolArgsSchema = z.object({});

export const PlanExitToolOutputSchema = z.object({
  switchedTo: z.string(),
  message: z.string(),
});

/**
 * Plan → Coder handoff flow tool. Signals that the plan was accepted and the
 * loop should continue as the Coder agent with the full toolset. Call only
 * after the user explicitly accepted the plan.
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
    return {
      switchedTo: "coder",
      message:
        "Plan approved. Switched from Plan to Coder — implement the approved plan now, starting with the first phase.",
    };
  },
});
