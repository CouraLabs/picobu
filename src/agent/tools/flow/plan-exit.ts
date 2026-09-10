import z from 'zod'
export const PlanExitToolArgsSchema = z.object({})
export const PlanExitToolOutputSchema = z.object({
  switchedTo: z.string(),
  message: z.string(),
})

export const createPlanExitTool = () => ({
  name: 'plan-exit',
  kind: 'flow' as const,
  description: 'Hand off to Coder to implement the approved plan; call only after explicit user approval.',
  parameters: PlanExitToolArgsSchema,
  output: PlanExitToolOutputSchema,
  handler: (): z.infer<typeof PlanExitToolOutputSchema> => {
    return {
      switchedTo: 'coder',
      message: 'Plan approved. Switched from Plan to Coder — implement the approved plan now, starting with the first phase.',
    }
  },
})
