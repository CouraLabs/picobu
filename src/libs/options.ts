import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { detectShell } from "./shell";
import { acquireLock } from "./lock";

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
  type: "openai-compatible" | "openai-responses" | "anthropic" | (string & {});
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models: ProviderModelOptions[];
}

/** The model roles the harness can be switched to. */
export type ModelRoleId =
  | "tiny"
  | "flash"
  | "flashThinking"
  | "heavy"
  | "heavyThinkingLevel";

/**
 * Per-role model/thinking overrides. `tiny`, `flash` and `heavy` are
 * `<providerId>/<modelId>` selectors (falling back to `defaultModel`).
 * `flashThinking` and `heavyThinkingLevel` are thinking-effort overrides for
 * their respective roles.
 */
export type ModelRoles = {
  /** tiny role model; thinking level defaults to `none`. */
  tiny?: string;
  /** flash role model. */
  flash?: string;
  /** Thinking level for the flash role; defaults to `medium`. */
  flashThinking?: ProviderModelReasoningEffort;
  /** heavy role model. */
  heavy?: string;
  /** Thinking level for the heavy role; defaults to `high`. */
  heavyThinkingLevel?: ProviderModelReasoningEffort;
};

export type HarnessOptions = {
  /** `<providerId>/<modelId>` fallback for every model role. Optional on disk; required before a model is used. */
  defaultModel?: string;
  /** Per-role model/thinking overrides. */
  modelRoles?: ModelRoles;
};

/** Shape of the harness block as stored on disk (defaultModel may be unset). */
export type HarnessOptionsInput = {
  defaultModel?: string;
  modelRoles?: ModelRoles;
};

/** User-selected theme name + light/dark variant, persisted for the next launch. */
export type ThemePrefs = {
  key: string;
  variant: "dark" | "light";
};

/** Web server (xterm.js) binding, read by `bun run web`. */
export type WebServerOptions = {
  host: string;
  port: number;
};

/** Defaults applied when the `web` block is missing or partially set. */
export const DEFAULT_WEB_OPTIONS: WebServerOptions = {
  host: "0.0.0.0",
  port: 8080,
};

export type OptionsExternal = {
  providers?: ProviderOptions[];
  /** Optional on disk; normalized to required once loaded. */
  harness?: HarnessOptionsInput;
  /** Optional on disk; defaults to `{ key: "tacos", variant: "dark" }` when unset. */
  theme?: ThemePrefs;
  /** Optional on disk; defaults to `{ host: "0.0.0.0", port: 8080 }` when unset. */
  web?: WebServerOptions;

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
  theme: ThemePrefs;
  web: WebServerOptions;

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

/** Which `modelRoles` field holds the model selector for each role. */
const ROLE_MODEL_FIELD: Record<ModelRoleId, "tiny" | "flash" | "heavy"> = {
  tiny: "tiny",
  flash: "flash",
  flashThinking: "flash",
  heavy: "heavy",
  heavyThinkingLevel: "heavy",
};

/**
 * Default thinking level for each role when the field is unset. `flash` and
 * `heavy` have no fixed default, so they inherit the model's `defaultEffort`.
 */
const ROLE_DEFAULT_THINKING: Record<ModelRoleId, ProviderModelReasoningEffort | undefined> = {
  tiny: "none",
  flash: undefined,
  flashThinking: "medium",
  heavy: undefined,
  heavyThinkingLevel: "high",
};

/**
 * Resolve the model selector and effective thinking level for a role,
 * applying the documented defaults and falling back to `defaultModel` for the
 * model selector.
 */
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

export const loadOptions = async (): Promise<Options> => {
  const externalOpts = await readExternalOptions();

  // `defaultModel` is optional on load so importing `options` never fails on a
  // model-less config (the Theme UI / Splash page stay usable). Model resolution
  // throws in `resolveModel`/`resolveModelRole` only once a model is actually
  // requested.
  return {
    ...globals,
    providers: externalOpts.providers ?? [],
    harness: externalOpts.harness as HarnessOptions,
    theme: externalOpts.theme ?? { key: "tacos", variant: "dark" },
    web: { ...DEFAULT_WEB_OPTIONS, ...externalOpts.web },

  } satisfies Options;
};

/** Read + create the external options file (`<systemDir>/options.json`). */
async function readExternalOptions(): Promise<OptionsExternal> {
  const systemDir = globals.app.systemDir;
  mkdirSync(systemDir, { recursive: true });
  const externalOptsPath = `${systemDir}/options.json`;
  const externalOptsFile = Bun.file(externalOptsPath);

  if (!await externalOptsFile.exists()) {
    await Bun.write(externalOptsPath, "{}");
    return {};
  }
  const externalOpts = (await externalOptsFile.json()) as OptionsExternal & {
    defaults?: { model?: string };
  };

  // Migrate the legacy `defaults: { model }` shape to `harness.defaultModel`
  // once, persisting the upgrade so it does not recur on every load.
  if (externalOpts.defaults?.model && !externalOpts.harness?.defaultModel) {
    const next: OptionsExternal = {
      ...externalOpts,
      harness: { ...externalOpts.harness, defaultModel: externalOpts.defaults.model },
      defaults: undefined,
    } as OptionsExternal;
    await Bun.write(externalOptsPath, JSON.stringify(next, null, 2));
    return next;
  }

  return externalOpts;
}

/**
 * Merge a partial settings patch into `<systemDir>/options.json` under the file
 * lock, then return the merged options. `harness`, `theme`, and `web` are shallow-merged

 * so partial role overrides / variant changes survive writes.
 */
export const updateSettings = async (
  patch: Partial<Pick<OptionsExternal, "providers" | "harness" | "theme" | "web">>,

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
      theme: {
        ...current.theme,
        ...patch.theme,
      } as ThemePrefs,
      web: {
        ...DEFAULT_WEB_OPTIONS,
        ...current.web,
        ...patch.web,
      } as WebServerOptions,
    };
    await Bun.write(externalOptsPath, JSON.stringify(next, null, 2));
    return { ...globals, ...next } as Options;
  } finally {
    lock.release();
  }
};

const options = await loadOptions();

export {
  options
}