import { type OptionsExternal, options, reloadOptions, updateSettings } from '@config/options.ts'
import { OptionsPatchSchema } from '@config/options-schema.ts'
import z from 'zod'

export const UpdateOptionsArgsSchema = z.object({
  patch: OptionsPatchSchema.describe('A partial options.json patch, e.g. { harness: { budgetLimitUsd: 5 } }.'),
})
export const UpdateOptionsOutputSchema = z.object({
  ok: z.boolean(),
  options: z.record(z.string(), z.unknown()),
})
export const ReloadOptionsOutputSchema = z.object({
  ok: z.boolean(),
})

const SECRET_KEYS = new Set(['apiKey', 'headers', 'token', 'secret'])

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact)
  if (typeof value !== 'object' || value === null) return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEYS.has(key) ? '[redacted]' : redact(entry)
  }
  return out
}

export const createUpdateOptionsTool = (deps?: { updateSettings?: typeof updateSettings }) => {
  const apply = deps?.updateSettings ?? updateSettings
  return {
    name: 'update-options',
    kind: 'flow' as const,
    description: "Patch picobu's options.json (e.g. harness, permissions, providers, tui, mcp). Returns the redacted options after the write.",
    parameters: UpdateOptionsArgsSchema,
    output: UpdateOptionsOutputSchema,
    handler: async (args: z.infer<typeof UpdateOptionsArgsSchema>) => {
      const next = await apply(args.patch as Partial<OptionsExternal>)
      options.harness = next.harness
      return { ok: true, options: redact(next) as Record<string, unknown> }
    },
  }
}

export const createReloadOptionsTool = (deps?: { reloadOptions?: typeof reloadOptions }) => {
  const reload = deps?.reloadOptions ?? reloadOptions
  return {
    name: 'reload-options',
    kind: 'flow' as const,
    description: 'Re-read options.json from disk so the current session picks up edits made outside picobu.',
    parameters: z.object({}),
    output: ReloadOptionsOutputSchema,
    handler: async () => {
      const next = await reload()
      options.harness = next.harness
      return { ok: true }
    },
  }
}
