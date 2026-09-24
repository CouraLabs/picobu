import { createProviderExecutedToolFactory } from '@ai-sdk/provider-utils'
import { z } from 'zod'
import type { OpenAIResponsesFileSearchToolComparisonFilter, OpenAIResponsesFileSearchToolCompoundFilter } from '../openai-responses-api-types.ts'

const comparisonFilterSchema = z.object({
  key: z.string(),
  type: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']),
  value: z.union([z.string(), z.number(), z.boolean()]),
})

const compoundFilterSchema: z.ZodType<OpenAIResponsesFileSearchToolCompoundFilter> = z.object({
  type: z.enum(['and', 'or']),
  filters: z.array(z.union([comparisonFilterSchema, z.lazy(() => compoundFilterSchema)])),
})

export const fileSearchArgsSchema = z.object({
  vectorStoreIds: z.array(z.string()),
  maxNumResults: z.number().optional(),
  ranking: z
    .object({
      ranker: z.string().optional(),
      scoreThreshold: z.number().optional(),
    })
    .optional(),
  filters: z.union([comparisonFilterSchema, compoundFilterSchema]).optional(),
})

export const fileSearchOutputSchema = z.object({
  queries: z.array(z.string()),
  results: z
    .array(
      z.object({
        attributes: z.record(z.string(), z.unknown()),
        fileId: z.string(),
        filename: z.string(),
        score: z.number(),
        text: z.string(),
      }),
    )
    .nullable(),
})

type FileSearchResult = {
  attributes: Record<string, unknown>
  fileId: string
  filename: string
  score: number
  text: string
}

type FileSearchArgs = {
  vectorStoreIds: Array<string>
  maxNumResults?: number
  ranking?: {
    ranker?: string
    scoreThreshold?: number
  }
  filters?: OpenAIResponsesFileSearchToolComparisonFilter | OpenAIResponsesFileSearchToolCompoundFilter
}

export const fileSearch = createProviderExecutedToolFactory<
  Record<string, never>,
  {
    queries: Array<string>
    results: Array<FileSearchResult> | null
  },
  FileSearchArgs
>({
  id: 'openai.file_search',
  inputSchema: z.object({}),
  outputSchema: fileSearchOutputSchema,
})
