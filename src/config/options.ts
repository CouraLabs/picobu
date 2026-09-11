import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { DEFAULT_MCP_OPTIONS, type McpOptions } from '@integrations/mcp/config.ts'
import { acquireLock } from '@shared/lock.ts'
import { detectShell } from '@shared/shell.ts'
export interface ProviderModelBilling {
  multiplier?: number
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  batchSize?: number
}
export type ProviderModelCapability = 'text' | 'vision' | (string & {})
export type ProviderModelReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | (string & {})
export interface ProviderModelOptions {
  id: string
  name: string
  description?: string
  context: number
  output: number
  reasoning?: boolean
  supports?: Array<ProviderModelCapability>
  efforts?: Array<ProviderModelReasoningEffort>
  defaultEffort?: ProviderModelReasoningEffort
  billing?: ProviderModelBilling
}
export interface ProviderOptions {
  id: string
  name: string
  type: 'openai' | 'openai-compatible' | 'openai-responses' | 'anthropic' | (string & {})
  baseUrl: string
  apiKey?: string
  headers?: Record<string, string>
  models: Array<ProviderModelOptions>
}
export type ModelRoleId = 'tiny' | 'flash' | 'flashThinking' | 'heavy' | 'heavyThinkingLevel'
export interface ModelRoles {
  tiny?: string
  flash?: string
  flashThinking?: ProviderModelReasoningEffort
  heavy?: string
  heavyThinkingLevel?: ProviderModelReasoningEffort
}
export interface HarnessOptions {
  defaultModel?: string
  modelRoles?: ModelRoles
  maxAgents?: number
}
export interface HarnessOptionsInput {
  defaultModel?: string
  modelRoles?: ModelRoles
  maxAgents?: number
}
export interface ThemePrefs {
  key: string
  variant: 'dark' | 'light'
}
export interface TuiOptionsInput {
  theme?: ThemePrefs
  maxMessages?: number
}
export interface TuiOptions {
  theme: ThemePrefs
  maxMessages: number
}
export const DEFAULT_TUI_OPTIONS: Pick<Required<TuiOptionsInput>, 'maxMessages'> = {
  maxMessages: 20,
}
export interface WatchdogOptionsInput {
  staleTimeoutMs?: number
  enableNotificationWhenStale?: boolean
  enableContinuePromptWhenStale?: boolean
}
export interface WatchdogOptions {
  staleTimeoutMs: number
  enableNotificationWhenStale: boolean
  enableContinuePromptWhenStale: boolean
}
export const DEFAULT_WATCHDOG_OPTIONS: WatchdogOptions = {
  staleTimeoutMs: 5 * 60 * 1000,
  enableNotificationWhenStale: true,
  enableContinuePromptWhenStale: false,
}
export interface WebServerOptions {
  host: string
  port: number
}
export interface WhatsAppOptions {
  enabled: boolean
  allowedNumbers: Array<string>
}
export const DEFAULT_WHATSAPP_OPTIONS: WhatsAppOptions = {
  enabled: false,
  allowedNumbers: [],
}
export const DEFAULT_WEB_OPTIONS: WebServerOptions = {
  host: '0.0.0.0',
  port: 8080,
}
export interface OptionsExternal {
  providers?: Array<ProviderOptions>
  harness?: HarnessOptionsInput
  theme?: ThemePrefs
  tui?: TuiOptionsInput
  web?: WebServerOptions
  whatsapp?: WhatsAppOptions
  mcp?: McpOptions
  watchdog?: WatchdogOptionsInput
}
export interface GlobalOptions {
  app: {
    name: string
    dir: string
    systemDir: string
    homeDir: string
    cwd: string
    os: string
    shell: string
  }
}
export type Options = GlobalOptions & {
  providers: Array<ProviderOptions>
  harness: HarnessOptions
  tui: TuiOptions
  web: WebServerOptions
  whatsapp: WhatsAppOptions
  mcp: McpOptions
  watchdog: WatchdogOptions
}
const globals: GlobalOptions = {
  app: {
    name: 'picobu',
    dir: '.picobu',
    systemDir: `${homedir()}/.picobu`,
    homeDir: homedir(),
    cwd: process.cwd(),
    os: process.platform,
    shell: detectShell(),
  },
}
const ROLE_MODEL_FIELD: Record<ModelRoleId, 'tiny' | 'flash' | 'heavy'> = {
  tiny: 'tiny',
  flash: 'flash',
  flashThinking: 'flash',
  heavy: 'heavy',
  heavyThinkingLevel: 'heavy',
}
const ROLE_DEFAULT_THINKING: Record<ModelRoleId, ProviderModelReasoningEffort | undefined> = {
  tiny: 'none',
  flash: undefined,
  flashThinking: 'medium',
  heavy: undefined,
  heavyThinkingLevel: 'high',
}
export function resolveModelRole(harness: HarnessOptions | undefined, role: ModelRoleId): { modelKey: string; thinking: ProviderModelReasoningEffort | undefined } {
  const modelRoles = harness?.modelRoles
  const modelKey = modelRoles?.[ROLE_MODEL_FIELD[role]] ?? harness?.defaultModel
  if (!modelKey) {
    throw new Error(`No defaultModel is set. Add "harness.defaultModel": "<providerId>/<modelId>" to ${globals.app.systemDir}/options.json`)
  }
  let thinking: ProviderModelReasoningEffort | undefined = ROLE_DEFAULT_THINKING[role]
  if (role === 'flashThinking') thinking = modelRoles?.flashThinking ?? 'medium'
  else if (role === 'heavyThinkingLevel') thinking = modelRoles?.heavyThinkingLevel ?? 'high'
  return { modelKey, thinking }
}
export const DEFAULT_THEME_PREFS: ThemePrefs = { key: 'picobu', variant: 'dark' }
const normalizeMaxMessages = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TUI_OPTIONS.maxMessages
  return Math.max(1, Math.floor(value))
}
const resolveTui = (external: OptionsExternal): TuiOptions => ({
  theme: external.tui?.theme ?? external.theme ?? DEFAULT_THEME_PREFS,
  maxMessages: normalizeMaxMessages(external.tui?.maxMessages),
})
const normalizeStaleTimeout = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WATCHDOG_OPTIONS.staleTimeoutMs
  return Math.max(5000, Math.floor(value))
}
const resolveWatchdog = (external: OptionsExternal): WatchdogOptions => ({
  staleTimeoutMs: normalizeStaleTimeout(external.watchdog?.staleTimeoutMs),
  enableNotificationWhenStale: external.watchdog?.enableNotificationWhenStale ?? DEFAULT_WATCHDOG_OPTIONS.enableNotificationWhenStale,
  enableContinuePromptWhenStale: external.watchdog?.enableContinuePromptWhenStale ?? DEFAULT_WATCHDOG_OPTIONS.enableContinuePromptWhenStale,
})
export const loadOptions = async (): Promise<Options> => {
  const externalOpts = await readExternalOptions()
  return {
    ...globals,
    providers: externalOpts.providers ?? [],
    harness: (externalOpts.harness ?? {}) as HarnessOptions,
    tui: resolveTui(externalOpts),
    web: { ...DEFAULT_WEB_OPTIONS, ...externalOpts.web },
    whatsapp: { ...DEFAULT_WHATSAPP_OPTIONS, ...externalOpts.whatsapp },
    mcp: { ...DEFAULT_MCP_OPTIONS, ...externalOpts.mcp },
    watchdog: resolveWatchdog(externalOpts),
  } satisfies Options
}
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    )
  }
  return value
}
const stableStringify = (value: unknown): string => JSON.stringify(sortKeys(value))
async function readExternalOptions(): Promise<OptionsExternal> {
  const systemDir = globals.app.systemDir
  mkdirSync(systemDir, { recursive: true })
  const externalOptsPath = `${systemDir}/options.json`
  const lock = await acquireLock(externalOptsPath)
  try {
    const externalOptsFile = Bun.file(externalOptsPath)
    let externalOpts: OptionsExternal & { defaults?: { model?: string } } = {}
    if (await externalOptsFile.exists()) {
      try {
        externalOpts = (await externalOptsFile.json()) as OptionsExternal & {
          defaults?: { model?: string }
        }
      } catch {
        try {
          const raw = await externalOptsFile.text()
          await Bun.write(`${externalOptsPath}.corrupt-${Date.now()}`, raw)
        } catch {}
        externalOpts = {}
      }
    }
    if (externalOpts.theme !== undefined) {
      externalOpts = {
        ...externalOpts,
        tui: {
          theme: externalOpts.tui?.theme ?? externalOpts.theme,
          maxMessages: normalizeMaxMessages(externalOpts.tui?.maxMessages),
        },
        theme: undefined,
      }
    }
    if (externalOpts.defaults?.model && !externalOpts.harness?.defaultModel) {
      externalOpts = {
        ...externalOpts,
        harness: { ...externalOpts.harness, defaultModel: externalOpts.defaults.model },
        defaults: undefined,
      } as OptionsExternal
    }
    const seeded: OptionsExternal = {
      ...externalOpts,
      tui: {
        ...externalOpts.tui,
        theme: externalOpts.tui?.theme ?? DEFAULT_THEME_PREFS,
        maxMessages: normalizeMaxMessages(externalOpts.tui?.maxMessages),
      },
      theme: undefined,
      web: { ...DEFAULT_WEB_OPTIONS, ...externalOpts.web },
      whatsapp: { ...DEFAULT_WHATSAPP_OPTIONS, ...externalOpts.whatsapp },
      mcp: { ...DEFAULT_MCP_OPTIONS, ...externalOpts.mcp },
      watchdog: { ...DEFAULT_WATCHDOG_OPTIONS, ...externalOpts.watchdog },
    }
    if (stableStringify(seeded) !== stableStringify(externalOpts)) {
      await Bun.write(externalOptsPath, JSON.stringify(seeded, null, 2))
    }
    return seeded
  } finally {
    lock.release()
  }
}
export const updateSettings = async (patch: Partial<Pick<OptionsExternal, 'providers' | 'harness' | 'tui' | 'web' | 'whatsapp' | 'mcp' | 'watchdog'>>): Promise<Options> => {
  const systemDir = globals.app.systemDir
  mkdirSync(systemDir, { recursive: true })
  const externalOptsPath = `${systemDir}/options.json`
  const lock = await acquireLock(externalOptsPath)
  try {
    let current: OptionsExternal = {}
    const file = Bun.file(externalOptsPath)
    if (await file.exists()) {
      try {
        current = (await file.json()) as OptionsExternal
      } catch {
        current = {}
      }
    }
    const next: OptionsExternal = {
      ...current,
      ...patch,
      harness: {
        ...current.harness,
        ...patch.harness,
        modelRoles: {
          ...current.harness?.modelRoles,
          ...patch.harness?.modelRoles,
        },
      },
      tui: {
        theme: patch.tui?.theme ?? current.tui?.theme ?? current.theme,
        maxMessages: normalizeMaxMessages(patch.tui?.maxMessages ?? current.tui?.maxMessages),
      },
      web: {
        ...DEFAULT_WEB_OPTIONS,
        ...current.web,
        ...patch.web,
      } as WebServerOptions,
      whatsapp: {
        ...DEFAULT_WHATSAPP_OPTIONS,
        ...current.whatsapp,
        ...patch.whatsapp,
      } as WhatsAppOptions,
      mcp: {
        ...DEFAULT_MCP_OPTIONS,
        ...current.mcp,
        ...patch.mcp,
      } as McpOptions,
      watchdog: {
        ...DEFAULT_WATCHDOG_OPTIONS,
        ...current.watchdog,
        ...patch.watchdog,
        staleTimeoutMs: normalizeStaleTimeout(patch.watchdog?.staleTimeoutMs ?? current.watchdog?.staleTimeoutMs),
      } as WatchdogOptions,
    }
    delete next.theme
    await Bun.write(externalOptsPath, JSON.stringify(next, null, 2))
    return loadOptions()
  } finally {
    lock.release()
  }
}
export const options = await loadOptions()
