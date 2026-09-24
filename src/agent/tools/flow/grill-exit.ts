import z from 'zod'
export const GrillExitToolArgsSchema = z.object({
  target: z
    .enum(['plan', 'coder'])
    .optional()
    .default('plan')
    .describe("Where to hand off: 'plan' to produce an implementation plan (default), or 'coder' to implement directly when the design is fully resolved and the change is small and clear."),
})
export const GrillExitToolOutputSchema = z.object({
  switchedTo: z.string(),
  message: z.string(),
})

export const createGrillExitTool = () => ({
  name: 'grill-exit',
  kind: 'flow' as const,
  description: 'Hand off after a shared understanding is reached; pass target "coder" to implement directly, or "plan" (default) to produce an implementation plan.',
  parameters: GrillExitToolArgsSchema,
  output: GrillExitToolOutputSchema,
  handler: (args: z.infer<typeof GrillExitToolArgsSchema>): z.infer<typeof GrillExitToolOutputSchema> => {
    if (args.target === 'coder') return { switchedTo: 'coder', message: 'Design agreed. Switched from Grill to Coder — implement the agreed design now.' }
    return { switchedTo: 'plan-code', message: 'Design agreed. Switched from Grill to Plan — produce the implementation plan.' }
  },
})
