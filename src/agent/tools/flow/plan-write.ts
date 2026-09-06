import z from "zod";
export const PlanWriteToolArgsSchema = z.object({
  plan: z.string().min(1),
});
export const PlanWriteToolOutputSchema = z.object({
  status: z.literal("pending"),
  message: z.string(),
});


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