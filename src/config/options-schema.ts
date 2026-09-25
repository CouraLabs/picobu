import z from 'zod'

export const ThemePrefsSchema = z.looseObject({
  key: z.string(),
  variant: z.enum(['dark', 'light']),
})

export const ProviderModelBillingSchema = z.looseObject({
  multiplier: z.number().optional(),
  input: z.number().optional(),
  output: z.number().optional(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
  batchSize: z.number().optional(),
})

export const ProviderModelSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
  context: z.number(),
  output: z.number(),
  reasoning: z.boolean().optional(),
  supports: z.array(z.string()).optional(),
  efforts: z.array(z.string()).optional(),
  defaultEffort: z.string().optional(),
  billing: ProviderModelBillingSchema.optional(),
  npm: z.string().optional(),
  endpoint: z.enum(['chat', 'responses', 'messages']).optional(),
  status: z.string().optional(),
})

export const ProviderSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  type: z.string(),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  npm: z.string().optional(),
  models: z.array(ProviderModelSchema),
})

export const ModelRolesSchema = z.looseObject({
  tiny: z.string().optional(),
  flash: z.string().optional(),
  flashThinking: z.string().optional(),
  heavy: z.string().optional(),
  heavyThinkingLevel: z.string().optional(),
})

export const HarnessSchema = z.looseObject({
  defaultModel: z.string().min(1).optional(),
  modelRoles: ModelRolesSchema.optional(),
  agent: z.record(z.string(), z.string()).optional(),
  maxAgents: z.number().int().min(1).optional(),
  doomLoop: z.boolean().optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
  budgetLimitUsd: z.number().min(0).optional(),
  defaultPermissionMode: z.enum(['yolo', 'ask', 'autopilot']).optional(),
})

export const TuiSchema = z.looseObject({
  theme: ThemePrefsSchema.optional(),
  maxMessages: z.number().int().min(1).optional(),
})

export const WebSchema = z.looseObject({
  host: z.string(),
  port: z.number().int(),
})

export const WhatsappSchema = z.looseObject({
  enabled: z.boolean(),
  allowedNumbers: z.array(z.string()),
})

export const McpServerSchema = z.looseObject({
  id: z.string().optional(),
  type: z.enum(['http', 'sse', 'stdio']).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  auth: z.boolean().optional(),
  instructions: z.string().optional(),
  maxRetries: z.number().int().min(0).optional(),
})

export const McpSchema = z.looseObject({
  servers: z.record(z.string(), McpServerSchema),
})

export const WatchdogSchema = z.looseObject({
  staleTimeoutMs: z.number().min(5000).optional(),
  enableNotificationWhenStale: z.boolean().optional(),
  enableContinuePromptWhenStale: z.boolean().optional(),
})

export const OptionsExternalSchema = z.looseObject({
  providers: z.array(ProviderSchema).optional(),
  statusLine: z.array(z.unknown()).optional(),
  sessionStatusLayout: z.unknown().optional(),
  sessionHeaderLayout: z.unknown().optional(),
  harness: HarnessSchema.optional(),
  theme: ThemePrefsSchema.optional(),
  tui: TuiSchema.optional(),
  web: WebSchema.partial().optional(),
  whatsapp: WhatsappSchema.partial().optional(),
  mcp: McpSchema.partial().optional(),
  watchdog: WatchdogSchema.optional(),
  defaults: z.looseObject({ model: z.string().optional() }).optional(),
})

export const HarnessPatchSchema = HarnessSchema.partial()

export const OptionsPatchSchema = z.looseObject({
  providers: z.array(ProviderSchema).optional(),
  statusLine: z.array(z.unknown()).optional(),
  sessionStatusLayout: z.unknown().optional(),
  sessionHeaderLayout: z.unknown().optional(),
  harness: HarnessPatchSchema.optional(),
  theme: ThemePrefsSchema.optional(),
  tui: TuiSchema.optional(),
  web: WebSchema.partial().optional(),
  whatsapp: WhatsappSchema.partial().optional(),
  mcp: McpSchema.partial().optional(),
  watchdog: WatchdogSchema.optional(),
})

export const formatOptionsIssues = (error: z.ZodError): string => error.issues.map((issue) => `${issue.path.join('.') || '(root)'} — ${issue.message}`).join('; ')
