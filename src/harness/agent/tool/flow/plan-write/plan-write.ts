import z from "zod";

export const PlanWriteToolArgsSchema = z.object({
  plan: z.string().min(1),
});

export const PlanWriteToolOutputSchema = z.object({
  status: z.literal("pending"),
  message: z.string(),
});

/**
 * Plan submission flow tool. Called when the Plan agent has finished the plan
 * with no open questions. The loop is interrupted after this call
 * (`stopWhen: hasToolCall("plan-write")`); the renderer opens a review dialog
 * with the plan markdown and per-line commenting. A follow-up prompt tells the
 * agent whether the user approved (→ call `plan-exit`) or rejected it (→
 * revise and call `plan-write` again).
 */
export const createPlanWriteTool = () => ({
  name: "plan-write",
  kind: "flow" as const,
  description: [
    "Submit the finished plan for user review. Call only when the plan is complete and you have no open questions.",
    "The run pauses; the user reviews the plan line by line and can attach per-line comments. A follow-up prompt",
    "tells you whether they approved (call plan-exit to hand off to the Coder) or rejected it (revise the plan",
    "addressing every comment and submit again with plan-write).",
  ].join(" "),
  parameters: PlanWriteToolArgsSchema,
  output: PlanWriteToolOutputSchema,
  handler: (args: z.infer<typeof PlanWriteToolArgsSchema>): z.infer<typeof PlanWriteToolOutputSchema> => {
    const lines = args.plan.split("\n").length;
    return {
      status: "pending",
      message: `Plan submitted for review (${lines} lines); awaiting user decision`,
    };
  },
});