import z from 'zod'
export const AskOptionSchema = z.object({
  answer: z.string().min(1),
  answerDescription: z.string().optional().default(''),
})
export const AskQuestionSchema = z.object({
  title: z.string().min(1),
  question: z.string().min(1),
  type: z.enum(['multiple', 'single']),
  options: z.array(AskOptionSchema).min(1),
})
export const AskToolArgsSchema = z.object({
  questions: z.array(AskQuestionSchema).min(1).max(5),
})
export const AskToolOutputSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), message: z.string() }),
  z.object({ status: z.literal('answered'), message: z.string() }),
  z.object({ status: z.literal('cancelled'), message: z.string() }),
])

export const createAskTool = () => ({
  name: 'ask',
  kind: 'flow' as const,
  description: 'Ask the user up to 5 structured single/multiple-choice questions; the run pauses and answers return as the tool result.',
  parameters: AskToolArgsSchema,
  output: AskToolOutputSchema,
  handler: (args: z.infer<typeof AskToolArgsSchema>): z.infer<typeof AskToolOutputSchema> => {
    if (!args.questions.length) throw new Error('ask requires at least one question')
    if (args.questions.length > 5) throw new Error('ask supports at most 5 questions per call')
    return {
      status: 'pending' as const,
      message: `Asked ${args.questions.length} question(s); awaiting user answers`,
    }
  },
})
