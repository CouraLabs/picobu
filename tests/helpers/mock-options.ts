import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HarnessOptions, ModelRoleId, Options, OptionsExternal, ProviderModelReasoningEffort } from '../../src/config/options.ts'
import { MAX_STATUS_LINE_ITEMS, normalizeStatusLine, normalizeStatusLines, selectStatusLineItems } from '../../src/config/provider-status-line.ts'
import { DEFAULT_SESSION_HEADER_LAYOUT, DEFAULT_SESSION_STATUS_LAYOUT } from '../../src/config/session-layout.ts'

export const mockSystemDirBase = mkdtempSync(join(tmpdir(), 'picobu-test-options-'))

const MOCK_THEME_PREFS = { key: 'picobu', variant: 'dark' } as const

const MOCK_TUI_DEFAULTS = { maxMessages: 20 } as const

const MOCK_WEB_DEFAULTS = { host: '0.0.0.0', port: 8080 } as const

const MOCK_WHATSAPP_DEFAULTS = { enabled: false, allowedNumbers: [] as Array<string> } as const

const MOCK_WATCHDOG_DEFAULTS = { staleTimeoutMs: 5 * 60 * 1000, enableNotificationWhenStale: true, enableContinuePromptWhenStale: false } as const

const baseOptions = (): Options => ({
  app: {
    name: 'picobu',
    dir: '.picobu',
    systemDir: mockSystemDirBase,
    homeDir: homedir(),
    cwd: process.cwd(),
    os: process.platform,
    shell: process.env.SHELL ?? 'sh',
  },
  providers: [],
  statusLine: [],
  sessionStatusLayout: { ...DEFAULT_SESSION_STATUS_LAYOUT, lines: DEFAULT_SESSION_STATUS_LAYOUT.lines.map((line) => [...line]) },
  sessionHeaderLayout: { ...DEFAULT_SESSION_HEADER_LAYOUT, lines: DEFAULT_SESSION_HEADER_LAYOUT.lines.map((line) => [...line]) },
  harness: {},
  tui: { theme: { ...MOCK_THEME_PREFS }, maxMessages: MOCK_TUI_DEFAULTS.maxMessages },
  web: { ...MOCK_WEB_DEFAULTS },
  whatsapp: { enabled: MOCK_WHATSAPP_DEFAULTS.enabled, allowedNumbers: [] },
  mcp: { servers: {} },
  watchdog: { ...MOCK_WATCHDOG_DEFAULTS },
})

export const mockOptions: Options = baseOptions()

export const resetMockOptions = (): Options => {
  const fresh = baseOptions()
  mockOptions.app = fresh.app
  mockOptions.providers = fresh.providers
  mockOptions.statusLine = fresh.statusLine
  mockOptions.harness = fresh.harness
  mockOptions.tui = fresh.tui
  mockOptions.web = fresh.web
  mockOptions.whatsapp = fresh.whatsapp
  mockOptions.mcp = fresh.mcp
  mockOptions.watchdog = fresh.watchdog
  return mockOptions
}

export const mockLoadOptions = async (): Promise<Options> => mockOptions

const normalizeMockMaxMessages = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MOCK_TUI_DEFAULTS.maxMessages
  return Math.max(1, Math.floor(value))
}

const normalizeMockStaleTimeout = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MOCK_WATCHDOG_DEFAULTS.staleTimeoutMs
  return Math.max(5000, Math.floor(value))
}

export const mockUpdateSettings = async (
  patch: Partial<Pick<OptionsExternal, 'providers' | 'statusLine' | 'sessionStatusLayout' | 'sessionHeaderLayout' | 'harness' | 'tui' | 'web' | 'whatsapp' | 'mcp' | 'watchdog'>>,
): Promise<Options> => {
  if (patch.providers !== undefined) mockOptions.providers = patch.providers
  if (patch.statusLine !== undefined) mockOptions.statusLine = patch.statusLine
  if (patch.sessionStatusLayout !== undefined) mockOptions.sessionStatusLayout = patch.sessionStatusLayout as Options['sessionStatusLayout']
  if (patch.sessionHeaderLayout !== undefined) mockOptions.sessionHeaderLayout = patch.sessionHeaderLayout as Options['sessionHeaderLayout']
  mockOptions.harness = {
    ...mockOptions.harness,
    ...patch.harness,
    modelRoles: { ...mockOptions.harness.modelRoles, ...patch.harness?.modelRoles },
  }
  mockOptions.tui = {
    theme: patch.tui?.theme ?? mockOptions.tui.theme,
    maxMessages: normalizeMockMaxMessages(patch.tui?.maxMessages ?? mockOptions.tui.maxMessages),
  }
  mockOptions.web = { ...mockOptions.web, ...patch.web }
  mockOptions.whatsapp = { ...mockOptions.whatsapp, ...patch.whatsapp }
  mockOptions.mcp = { ...mockOptions.mcp, ...patch.mcp }
  mockOptions.watchdog = {
    ...mockOptions.watchdog,
    ...patch.watchdog,
    staleTimeoutMs: normalizeMockStaleTimeout(patch.watchdog?.staleTimeoutMs ?? mockOptions.watchdog.staleTimeoutMs),
  }
  return mockOptions
}

const MOCK_ROLE_MODEL_FIELD: Record<ModelRoleId, 'tiny' | 'flash' | 'heavy'> = {
  tiny: 'tiny',
  flash: 'flash',
  flashThinking: 'flash',
  heavy: 'heavy',
  heavyThinkingLevel: 'heavy',
}

const MOCK_ROLE_DEFAULT_THINKING: Record<ModelRoleId, ProviderModelReasoningEffort | undefined> = {
  tiny: 'none',
  flash: undefined,
  flashThinking: 'medium',
  heavy: undefined,
  heavyThinkingLevel: 'high',
}

export const mockResolveModelRole = (harness: HarnessOptions | undefined, role: ModelRoleId): { modelKey: string; thinking: ProviderModelReasoningEffort | undefined } => {
  const modelRoles = harness?.modelRoles
  const modelKey = modelRoles?.[MOCK_ROLE_MODEL_FIELD[role]] ?? harness?.defaultModel
  if (!modelKey) {
    throw new Error(`No defaultModel is set. Add "harness.defaultModel": "<providerId>/<modelId>" to ${mockOptions.app.systemDir}/options.json`)
  }
  let thinking: ProviderModelReasoningEffort | undefined = MOCK_ROLE_DEFAULT_THINKING[role]
  if (role === 'flashThinking') thinking = modelRoles?.flashThinking ?? 'medium'
  else if (role === 'heavyThinkingLevel') thinking = modelRoles?.heavyThinkingLevel ?? 'high'
  return { modelKey, thinking }
}

export const mockOptionsModule = () => ({
  options: mockOptions,
  loadOptions: mockLoadOptions,
  updateSettings: mockUpdateSettings,
  resolveModelRole: mockResolveModelRole,
  normalizeStatusLine,
  normalizeStatusLines,
  selectStatusLineItems,
  MAX_STATUS_LINE_ITEMS,
  DEFAULT_TUI_OPTIONS: { maxMessages: MOCK_TUI_DEFAULTS.maxMessages },
  DEFAULT_WATCHDOG_OPTIONS: { ...MOCK_WATCHDOG_DEFAULTS },
  DEFAULT_WHATSAPP_OPTIONS: { enabled: MOCK_WHATSAPP_DEFAULTS.enabled, allowedNumbers: [] as Array<string> },
  DEFAULT_WEB_OPTIONS: { ...MOCK_WEB_DEFAULTS },
  DEFAULT_THEME_PREFS: { ...MOCK_THEME_PREFS },
})
