import z from 'zod'
export const PlanWriteToolArgsSchema = z.object({
  plan: z.string().min(1),
})
export const PlanWriteToolOutputSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), message: z.string() }),
  z.object({ status: z.literal('approved'), message: z.string() }),
  z.object({ status: z.literal('rejected'), message: z.string() }),
  z.object({ status: z.literal('cancelled'), message: z.string() }),
])

export const createPlanWriteTool = () => ({
  name: 'plan-write',
  kind: 'flow' as const,
  description: 'Submit the complete plan for user review; the verdict returns as the result (approved: call plan-exit, rejected: revise and resubmit).',
  parameters: PlanWriteToolArgsSchema,
  output: PlanWriteToolOutputSchema,
  handler: (args: z.infer<typeof PlanWriteToolArgsSchema>): z.infer<typeof PlanWriteToolOutputSchema> => {
    const lines = args.plan.split('\n').length
    return {
      status: 'pending' as const,
      message: `Plan submitted for review (${lines} lines); awaiting user decision`,
    }
  },
})
