import { createProviderExecutedToolFactory } from '@ai-sdk/provider-utils'
import { z } from 'zod'

export const codeInterpreterInputSchema = z.object({
  code: z.string().nullish(),
  containerId: z.string(),
})

export const codeInterpreterOutputSchema = z.object({
  outputs: z.array(z.discriminatedUnion('type', [z.object({ type: z.literal('logs'), logs: z.string() }), z.object({ type: z.literal('image'), url: z.string() })])).nullish(),
})

export const codeInterpreterArgsSchema = z.object({
  container: z
    .union([
      z.string(),
      z.object({
        fileIds: z.array(z.string()).optional(),
      }),
    ])
    .optional(),
})

type CodeInterpreterArgs = {
  container?: string | { fileIds?: Array<string> }
}

export const codeInterpreterToolFactory = createProviderExecutedToolFactory<z.infer<typeof codeInterpreterInputSchema>, z.infer<typeof codeInterpreterOutputSchema>, CodeInterpreterArgs>({
  id: 'openai.code_interpreter',
  inputSchema: codeInterpreterInputSchema,
  outputSchema: codeInterpreterOutputSchema,
})

export const codeInterpreter = (args: CodeInterpreterArgs = {}) => {
  return codeInterpreterToolFactory(args)
}
