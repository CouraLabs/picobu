import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { DEFAULT_MCP_OPTIONS, type McpOptions } from "@integrations/mcp/config.ts";
import { acquireLock } from "@shared/lock.ts";
import { detectShell } from "@shared/shell.ts";
export type ProviderModelBilling = {
  multiplier?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  batchSize?: number;
};
export type ProviderModelCapability = "text" | "vision" | (string & {});
export type ProviderModelReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max" | (string & {});
export type ProviderModelOptions = {
  id: string;
  name: string;
  description?: string;
  context: number;
  output: number;
  reasoning?: boolean;
  supports?: ProviderModelCapability[];
  efforts?: ProviderModelReasoningEffort[];
  defaultEffort?: ProviderModelReasoningEffort;
  billing?: ProviderModelBilling;
};
export type ProviderOptions = {
  id: string;
  name: string;
  type: "openai" | "openai-compatible" | "openai-responses" | "anthropic" | (string & {});
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models: ProviderModelOptions[];
};
export type ModelRoleId = "tiny" | "flash" | "flashThinking" | "heavy" | "heavyThinkingLevel";
export type ModelRoles = {
  tiny?: string;
  flash?: string;
  flashThinking?: ProviderModelReasoningEffort;
  heavy?: string;
  heavyThinkingLevel?: ProviderModelReasoningEffort;
};
export type HarnessOptions = {
  defaultModel?: string;
  modelRoles?: ModelRoles;
  maxAgents?: number;
};
export type HarnessOptionsInput = {
  defaultModel?: string;
  modelRoles?: ModelRoles;
  maxAgents?: number;
};
export type ThemePrefs = {
  key: string;
  variant: "dark" | "light";
};
export type TuiOptionsInput = {
  theme?: ThemePrefs;
  maxMessages?: number;
};
export type TuiOptions = {
  theme: ThemePrefs;
  maxMessages: number;
};
export const DEFAULT_TUI_OPTIONS: Pick<Required<TuiOptionsInput>, "maxMessages"> = {
  maxMessages: 20,
};
export type WebServerOptions = {
  host: string;
  port: number;
};
export type WhatsAppOptions = {
  enabled: boolean;
  allowedNumbers: string[];
};
export const DEFAULT_WHATSAPP_OPTIONS: WhatsAppOptions = {
  enabled: false,
  allowedNumbers: [],
};
export const DEFAULT_WEB_OPTIONS: WebServerOptions = {
  host: "0.0.0.0",
  port: 8080,
};
export type OptionsExternal = {
  providers?: ProviderOptions[];
  harness?: HarnessOptionsInput;
  theme?: ThemePrefs;
  tui?: TuiOptionsInput;
  web?: WebServerOptions;
  whatsapp?: WhatsAppOptions;
  mcp?: McpOptions;
};
export type GlobalOptions = {
  app: {
    name: string;
    dir: string;
    systemDir: string;
    homeDir: string;
    cwd: string;
    os: string;
    shell: string;
  };
};
export type Options = GlobalOptions & {
  providers: ProviderOptions[];
  harness: HarnessOptions;
  tui: TuiOptions;
  web: WebServerOptions;
  whatsapp: WhatsAppOptions;
  mcp: McpOptions;
};
const globals: GlobalOptions = {
  app: {
    name: "picobu",
    dir: ".picobu",
    systemDir: `${homedir()}/.picobu`,
    homeDir: homedir(),
    cwd: process.cwd(),
    os: process.platform,
    shell: detectShell(),
  },
};
const ROLE_MODEL_FIELD: Record<ModelRoleId, "tiny" | "flash" | "heavy"> = {
  tiny: "tiny",
  flash: "flash",
  flashThinking: "flash",
  heavy: "heavy",
  heavyThinkingLevel: "heavy",
};
const ROLE_DEFAULT_THINKING: Record<ModelRoleId, ProviderModelReasoningEffort | undefined> = {
  tiny: "none",
  flash: undefined,
  flashThinking: "medium",
  heavy: undefined,
  heavyThinkingLevel: "high",
};
export function resolveModelRole(harness: HarnessOptions | undefined, role: ModelRoleId): { modelKey: string; thinking: ProviderModelReasoningEffort | undefined } {
  const modelRoles = harness?.modelRoles;
  const modelKey = modelRoles?.[ROLE_MODEL_FIELD[role]] ?? harness?.defaultModel;
  if (!modelKey) {
    throw new Error(`No defaultModel is set. Add "harness.defaultModel": "<providerId>/<modelId>" to ${globals.app.systemDir}/options.json`);
  }
  let thinking: ProviderModelReasoningEffort | undefined = ROLE_DEFAULT_THINKING[role];
  if (role === "flashThinking") thinking = modelRoles?.flashThinking ?? "medium";
  else if (role === "heavyThinkingLevel") thinking = modelRoles?.heavyThinkingLevel ?? "high";
  return { modelKey, thinking };
}
export const DEFAULT_THEME_PREFS: ThemePrefs = { key: "tacos", variant: "dark" };
const normalizeMaxMessages = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TUI_OPTIONS.maxMessages;
  return Math.max(1, Math.floor(value));
};
const resolveTui = (external: OptionsExternal): TuiOptions => ({
  theme: external.tui?.theme ?? external.theme ?? DEFAULT_THEME_PREFS,
  maxMessages: normalizeMaxMessages(external.tui?.maxMessages),
});
export const loadOptions = async (): Promise<Options> => {
  const externalOpts = await readExternalOptions();
  return {
    ...globals,
    providers: externalOpts.providers ?? [],
    harness: (externalOpts.harness ?? {}) as HarnessOptions,
    tui: resolveTui(externalOpts),
    web: { ...DEFAULT_WEB_OPTIONS, ...externalOpts.web },
    whatsapp: { ...DEFAULT_WHATSAPP_OPTIONS, ...externalOpts.whatsapp },
    mcp: { ...DEFAULT_MCP_OPTIONS, ...externalOpts.mcp },
  } satisfies Options;
};
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    );
  }
  return value;
};
const stableStringify = (value: unknown): string => JSON.stringify(sortKeys(value));
async function readExternalOptions(): Promise<OptionsExternal> {
  const systemDir = globals.app.systemDir;
  mkdirSync(systemDir, { recursive: true });
  const externalOptsPath = `${systemDir}/options.json`;
  const lock = await acquireLock(externalOptsPath);
  try {
    const externalOptsFile = Bun.file(externalOptsPath);
    let externalOpts: OptionsExternal & { defaults?: { model?: string } } = {};
    if (await externalOptsFile.exists()) {
      try {
        externalOpts = (await externalOptsFile.json()) as OptionsExternal & {
          defaults?: { model?: string };
        };
      } catch {
        try {
          const raw = await externalOptsFile.text();
          await Bun.write(`${externalOptsPath}.corrupt-${Date.now()}`, raw);
        } catch {}
        externalOpts = {};
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
      };
    }
    if (externalOpts.defaults?.model && !externalOpts.harness?.defaultModel) {
      externalOpts = {
        ...externalOpts,
        harness: { ...externalOpts.harness, defaultModel: externalOpts.defaults.model },
        defaults: undefined,
      } as OptionsExternal;
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
    };
    if (stableStringify(seeded) !== stableStringify(externalOpts)) {
      await Bun.write(externalOptsPath, JSON.stringify(seeded, null, 2));
    }
    return seeded;
  } finally {
    lock.release();
  }
}
export const updateSettings = async (patch: Partial<Pick<OptionsExternal, "providers" | "harness" | "tui" | "web" | "whatsapp" | "mcp">>): Promise<Options> => {
  const systemDir = globals.app.systemDir;
  mkdirSync(systemDir, { recursive: true });
  const externalOptsPath = `${systemDir}/options.json`;
  const lock = await acquireLock(externalOptsPath);
  try {
    let current: OptionsExternal = {};
    const file = Bun.file(externalOptsPath);
    if (await file.exists()) {
      try {
        current = (await file.json()) as OptionsExternal;
      } catch {
        current = {};
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
    };
    delete next.theme;
    await Bun.write(externalOptsPath, JSON.stringify(next, null, 2));
    return loadOptions();
  } finally {
    lock.release();
  }
};
export const options = await loadOptions();
