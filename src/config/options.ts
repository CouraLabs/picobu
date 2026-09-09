import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { detectShell } from "@shared/shell.ts";
import { acquireLock } from "@shared/lock.ts";
import { DEFAULT_MCP_OPTIONS, type McpOptions } from "@integrations/mcp/config.ts";
export type ProviderModelBilling = {
  multiplier?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  batchSize?: number;
};
export type ProviderModelCapability = "text" | "vision" | (string & {});
export type ProviderModelReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | (string & {});
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
}


export type ModelRoleId =
  | "tiny"
  | "flash"
  | "flashThinking"
  | "heavy"
  | "heavyThinkingLevel";


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


export type WhatsAppOptions = {  /** Master switch: auto-connect at startup and process inbound messages. */
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
  /** @deprecated Moved to `tui.theme`. Auto-migrated on load. */
  theme?: ThemePrefs;
  tui?: TuiOptionsInput;
  web?: WebServerOptions;
  whatsapp?: WhatsAppOptions;
  mcp?: McpOptions;
}
export type GlobalOptions = {
  app: {
    name: string, 
    dir: string,
    systemDir: string,
    homeDir: string,
    cwd: string,
    os: string,
    shell: string
  },
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
    name: 'picobu',
    dir: '.picobu',
    systemDir: `${homedir()}/.picobu`,
    homeDir: homedir(),
    cwd: process.cwd(),
    os: process.platform,
    shell: detectShell()
  }
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


export function resolveModelRole(
  harness: HarnessOptions | undefined,
  role: ModelRoleId,
): { modelKey: string; thinking: ProviderModelReasoningEffort | undefined } {
  const modelRoles = harness?.modelRoles;
  const modelKey = modelRoles?.[ROLE_MODEL_FIELD[role]] ?? harness?.defaultModel;
  if (!modelKey) {
    throw new Error(
      `No defaultModel is set. Add "harness.defaultModel": "<providerId>/<modelId>" to ${globals.app.systemDir}/options.json`,
    );
  }
  let thinking: ProviderModelReasoningEffort | undefined = ROLE_DEFAULT_THINKING[role];
  if (role === "flashThinking") thinking = modelRoles?.flashThinking ?? "medium";
  else if (role === "heavyThinkingLevel") thinking = modelRoles?.heavyThinkingLevel ?? "high";
  return { modelKey, thinking };
}
export const DEFAULT_THEME_PREFS: ThemePrefs = { key: "tacos", variant: "dark" };

const resolveTui = (external: OptionsExternal): TuiOptions => ({
  // Migrate the pre-`tui` top-level `theme` key into `tui.theme`.
  theme: external.tui?.theme ?? external.theme ?? DEFAULT_THEME_PREFS,
  maxMessages: Math.max(1, external.tui?.maxMessages ?? DEFAULT_TUI_OPTIONS.maxMessages),
});

export const loadOptions = async (): Promise<Options> => {
  const externalOpts = await readExternalOptions();

  
  
  
  
  return {
    ...globals,
    providers: externalOpts.providers ?? [],
    harness: externalOpts.harness as HarnessOptions,
    tui: resolveTui(externalOpts),
    web: { ...DEFAULT_WEB_OPTIONS, ...externalOpts.web },
    whatsapp: { ...DEFAULT_WHATSAPP_OPTIONS, ...externalOpts.whatsapp },
    mcp: { ...DEFAULT_MCP_OPTIONS, ...externalOpts.mcp },
  } satisfies Options;
};


async function readExternalOptions(): Promise<OptionsExternal> {
  const systemDir = globals.app.systemDir;
  mkdirSync(systemDir, { recursive: true });
  const externalOptsPath = `${systemDir}/options.json`;
  const externalOptsFile = Bun.file(externalOptsPath);
  // File may not exist yet; start from an empty config and seed it below.
  let externalOpts = (await externalOptsFile.exists())
    ? ((await externalOptsFile.json()) as OptionsExternal & {
        defaults?: { model?: string };
      })
    : {};

  // Migrate the pre-`tui` top-level `theme` key into `tui.theme`.
  if (externalOpts.theme !== undefined) {
    externalOpts = {
      ...externalOpts,
      tui: {
        theme: externalOpts.tui?.theme ?? externalOpts.theme,
        maxMessages: externalOpts.tui?.maxMessages ?? DEFAULT_TUI_OPTIONS.maxMessages,
      },
      theme: undefined,
    };
  }

  // Migrate the pre-`harness` `defaults.model` key into `harness.defaultModel`.
  if (externalOpts.defaults?.model && !externalOpts.harness?.defaultModel) {
    externalOpts = {
      ...externalOpts,
      harness: { ...externalOpts.harness, defaultModel: externalOpts.defaults.model },
      defaults: undefined,
    } as OptionsExternal;
  }

  // Fill every unset block with its defaults so the on-disk file always
  // shows the effective default configuration to the user.
  const seeded: OptionsExternal = {
    ...externalOpts,
    tui: {
      theme: externalOpts.tui?.theme ?? DEFAULT_THEME_PREFS,
      maxMessages: externalOpts.tui?.maxMessages ?? DEFAULT_TUI_OPTIONS.maxMessages,
    },
    theme: undefined,
    web: { ...DEFAULT_WEB_OPTIONS, ...externalOpts.web },
    whatsapp: { ...DEFAULT_WHATSAPP_OPTIONS, ...externalOpts.whatsapp },
    mcp: { ...DEFAULT_MCP_OPTIONS, ...externalOpts.mcp },
  };
  // Only rewrite when something actually changed (new file, migration, or
  // newly seeded defaults) to avoid churn on every startup.
  if (JSON.stringify(seeded) !== JSON.stringify(externalOpts)) {
    await Bun.write(externalOptsPath, JSON.stringify(seeded, null, 2));
  }
  return seeded;
}


export const updateSettings = async (
  patch: Partial<Pick<OptionsExternal, "providers" | "harness" | "tui" | "web" | "whatsapp" | "mcp">>,
): Promise<Options> => {
  const systemDir = globals.app.systemDir;
  mkdirSync(systemDir, { recursive: true });
  const externalOptsPath = `${systemDir}/options.json`;
  const lock = await acquireLock(externalOptsPath);
  try {
    let current: OptionsExternal = {};
    const file = Bun.file(externalOptsPath);
    if (await file.exists()) current = (await file.json()) as OptionsExternal;
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
        // Fold the legacy top-level theme into `tui.theme` on every save.
        theme: patch.tui?.theme ?? current.tui?.theme ?? current.theme,
        maxMessages: patch.tui?.maxMessages ?? current.tui?.maxMessages ?? DEFAULT_TUI_OPTIONS.maxMessages,
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