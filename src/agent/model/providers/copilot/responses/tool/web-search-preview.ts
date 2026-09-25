import { z } from 'zod'

export const webSearchPreviewArgsSchema = z.object({
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
