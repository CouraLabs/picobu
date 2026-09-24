import { createProviderExecutedToolFactory } from '@ai-sdk/provider-utils'
import { z } from 'zod'

export const webSearchArgsSchema = z.object({
  filters: z
    .object({
      allowedDomains: z.array(z.string()).optional(),
    })
    .optional(),
  searchContextSize: z.enum(['low', 'medium', 'high']).optional(),
  userLocation: z
    .object({
      type: z.literal('approximate'),
      country: z.string().optional(),
      city: z.string().optional(),
      region: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
})

export const webSearchInputSchema = z.object({
  action: z
    .discriminatedUnion('type', [
      z.object({
        type: z.literal('search'),
        query: z.string().nullish(),
      }),
      z.object({
        type: z.literal('open_page'),
        url: z.string(),
      }),
      z.object({
        type: z.literal('find'),
        url: z.string(),
        pattern: z.string(),
      }),
    ])
    .nullish(),
})

export const webSearchOutputSchema = z.object({
  status: z.string(),
})

type WebSearchArgs = {
  filters?: {
    allowedDomains?: Array<string>
  }
  searchContextSize?: 'low' | 'medium' | 'high'
  userLocation?: {
    type: 'approximate'
    country?: string
    city?: string
    region?: string
    timezone?: string
  }
}

export const webSearchToolFactory = createProviderExecutedToolFactory<z.infer<typeof webSearchInputSchema>, z.infer<typeof webSearchOutputSchema>, WebSearchArgs>({
  id: 'openai.web_search',
  inputSchema: webSearchInputSchema,
  outputSchema: webSearchOutputSchema,
})

export const webSearch = (args: WebSearchArgs = {}) => {
  return webSearchToolFactory(args)
}
