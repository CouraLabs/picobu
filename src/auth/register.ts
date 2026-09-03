import type { Provider as ModelsDevProvider } from "@opencode-ai/models";
import {
  options,
  updateSettings,
  type HarnessOptions,
  type HarnessOptionsInput,
  type ProviderModelOptions,
  type ProviderOptions,
} from "../libs/options";
import { upsertProvider } from "../harness/agent/factory/llm-providers/registry";
import { fetchModelsDevProvider, modelsFromModelsDev } from "../harness/agent/factory/llm-providers/models-dev";
import { removeCredential, setCredential } from "./store";
import { getGitHubCopilotBaseUrl } from "./github-copilot";
import type { OAuthAuth, OAuthCredential } from "./types";

/**
 * Post-login provider registration — the exact "same as hyper" procedure used
 * by the Charm Hyper autoload (`llm-providers/registry.ts`): build a
 * `ProviderOptions` with models from the models.dev catalog (opencode/models),
 * `upsertProvider` it into `~/.picobu/options.json`, sync the in-memory
 * `options` singleton, hydrate the settings store, and set `defaultModel` when
 * the config has none. Raw tokens never reach options.json — providers carry
 * an `apiKey: "auth:<id>"` reference resolved at request time from auth.json.
 */

type ProviderMeta = {
  type: "openai" | "anthropic" | "openai-compatible";
  baseUrl?: string;
  /** models.dev catalog env key that identifies the provider entry. */
  catalogEnv: string;
};

const PROVIDER_META: Record<string, ProviderMeta> = {
  openai: { type: "openai", baseUrl: "https://api.openai.com/v1", catalogEnv: "OPENAI_API_KEY" },
  anthropic: { type: "anthropic", baseUrl: "https://api.anthropic.com/v1", catalogEnv: "ANTHROPIC_API_KEY" },
  "github-copilot": { type: "openai-compatible", catalogEnv: "GITHUB_TOKEN" },
};

/**
 * Copilot's usable models depend on the account: keep the models.dev
 * `github-copilot` catalog entries whose ids the account advertises, then
 * append catalog-less ids as minimal (id-only) entries so nothing the account
 * knows about disappears from the picker.
 */
export const selectCopilotModels = (
  catalog: ModelsDevProvider,
  availableModelIds: string[] | undefined,
): ProviderModelOptions[] => {
  const ids = availableModelIds ?? [];
  // No live account list (or one that advertised nothing): keep the whole
  // catalog so the account's models are never hidden.
  if (ids.length === 0) return modelsFromModelsDev(catalog);
  const wanted = new Set(ids);
  const fromCatalog = modelsFromModelsDev(catalog).filter((m) => wanted.has(m.id));
  const extras = ids
    .filter((id) => !fromCatalog.some((m) => m.id === id))
    .map((id): ProviderModelOptions => ({ id, name: id, context: 0, output: 0, supports: ["text"] }));
  return [...fromCatalog, ...extras];
};

/** Default model for a fresh provider: first reasoning-capable model, else first. */
export const pickDefaultModel = (models: ProviderModelOptions[]): string | undefined =>
  (models.find((m) => m.reasoning === true) ?? models[0])?.id;

export const registerOAuthProvider = async (auth: OAuthAuth, credential: OAuthCredential): Promise<void> => {
  const meta = PROVIDER_META[auth.id];
  if (!meta) throw new Error(`No registration metadata for OAuth provider "${auth.id}"`);
  await setCredential(auth.id, credential);

  // Model metadata via models.dev (the "opencode/models" catalog fetch).
  const catalog = await fetchModelsDevProvider(meta.catalogEnv);
  const models = catalog
    ? auth.id === "github-copilot"
      ? selectCopilotModels(catalog, credential.availableModelIds)
      : modelsFromModelsDev(catalog)
    : [];
  if (models.length === 0) {
    throw new Error(`Could not load ${auth.name} models from the models.dev catalog`);
  }

  const requestAuth = auth.toAuth(credential);
  const provider: ProviderOptions = {
    id: auth.id,
    name: auth.name,
    type: meta.type,
    baseUrl:
      requestAuth.baseUrl ??
      meta.baseUrl ??
      getGitHubCopilotBaseUrl(credential.access, credential.enterpriseUrl),
    apiKey: `auth:${auth.id}`,
    models,
  };

  const providers = upsertProvider(options.providers, provider);
  const defaultModelKey = `${auth.id}/${pickDefaultModel(models)}`;
  const setDefaultModel = !options.harness?.defaultModel;
  const next = await updateSettings({
    providers,
    ...(setDefaultModel ? { harness: { defaultModel: defaultModelKey } } : {}),
  });

  // `updateSettings` only writes the file; mirror the merged result onto the
  // singleton + settings store so the picker/model resolution pick it up live.
  options.providers = next.providers;
  if (next.harness) options.harness = next.harness;
};

/**
 * Repoint every harness selector (`defaultModel` + model roles) that references
 * the removed provider at the first remaining provider/model (undefined when no
 * providers are left).
 */
export const fixHarnessAfterLogout = (
  harness: HarnessOptions | undefined,
  providerId: string,
  providers: ProviderOptions[],
): HarnessOptionsInput => {
  const first = providers[0];
  const firstModel = first ? pickDefaultModel(first.models) ?? first.models[0]?.id : undefined;
  const fallback = first && firstModel ? `${first.id}/${firstModel}` : undefined;
  const repoint = (selector?: string): string | undefined =>
    selector && selector.startsWith(`${providerId}/`) ? fallback : selector;
  return {
    ...(harness ?? {}),
    defaultModel: repoint(harness?.defaultModel),
    modelRoles: {
      ...(harness?.modelRoles ?? {}),
      tiny: repoint(harness?.modelRoles?.tiny),
      flash: repoint(harness?.modelRoles?.flash),
      heavy: repoint(harness?.modelRoles?.heavy),
    },
  };
};

/**
 * Repoint a session's selected model key if it referenced the removed
 * provider. Returns "" when no provider/model remains to fall back to.
 */
export const repointModelKey = (
  modelKey: string,
  removedProviderId: string,
  providers: ProviderOptions[],
): string => {
  if (!modelKey.startsWith(`${removedProviderId}/`)) return modelKey;
  const first = providers[0];
  const model = first ? pickDefaultModel(first.models) ?? first.models[0]?.id : undefined;
  return first && model ? `${first.id}/${model}` : "";
};

/**
 * `/logout <id>`: drop the credential from auth.json, remove the provider
 * whose apiKey is the `auth:<id>` reference from options.json, and repoint any
 * harness selectors away from it. Returns whether anything changed plus the
 * session model key to select next ("" = none).
 */
export const logoutOAuthProvider = async (
  id: string,
  currentModelKey: string,
): Promise<{ removed: boolean; nextModelKey: string }> => {
  const removedCredential = await removeCredential(id);
  const providers = options.providers.filter((p) => p.apiKey !== `auth:${id}`);
  const harness = fixHarnessAfterLogout(options.harness, id, providers);
  const changed =
    providers.length !== options.providers.length ||
    JSON.stringify(harness) !== JSON.stringify(options.harness);
  if (changed) {
    const next = await updateSettings({ providers, harness });
    options.providers = next.providers;
    if (next.harness) options.harness = next.harness;
    }
  return {
    removed: removedCredential || changed,
    nextModelKey: repointModelKey(currentModelKey, id, options.providers),
  };
};