import type { Provider as ModelsDevProvider } from "@opencode-ai/models";
import {
  options,
  updateSettings,
  type HarnessOptions,
  type HarnessOptionsInput,
  type ProviderModelOptions,
  type ProviderOptions,
} from "@config/options.ts";
import { upsertProvider } from "@agent/model/registry.ts";
import { fetchModelsDevProvider, modelsFromModelsDev } from "@agent/model/catalog-models-dev.ts";
import { removeCredential, setCredential } from "@auth/store.ts";
import { getGitHubCopilotBaseUrl } from "@auth/github-copilot.ts";
import type { OAuthAuth, OAuthCredential } from "@auth/types.ts";
type ProviderMeta = {
  type: "openai" | "anthropic" | "openai-compatible";
  baseUrl?: string;
  catalogEnv: string;
};
const PROVIDER_META: Record<string, ProviderMeta> = {
  openai: { type: "openai", baseUrl: "https://api.openai.com/v1", catalogEnv: "OPENAI_API_KEY" },
  anthropic: { type: "anthropic", baseUrl: "https://api.anthropic.com/v1", catalogEnv: "ANTHROPIC_API_KEY" },
  "github-copilot": { type: "openai-compatible", catalogEnv: "GITHUB_TOKEN" },
};
export const selectCopilotModels = (
  catalog: ModelsDevProvider,
  availableModelIds: string[] | undefined,
): ProviderModelOptions[] => {
  if (availableModelIds === undefined) return modelsFromModelsDev(catalog);
  const ids = availableModelIds;
  if (ids.length === 0) return [];
  const wanted = new Set(ids);
  const fromCatalog = modelsFromModelsDev(catalog).filter((m) => wanted.has(m.id));
  const extras = ids
    .filter((id) => !fromCatalog.some((m) => m.id === id))
    .map((id): ProviderModelOptions => ({ id, name: id, context: 0, output: 0, supports: ["text"] }));
  return [...fromCatalog, ...extras];
};
export const pickDefaultModel = (models: ProviderModelOptions[]): string | undefined =>
  (models.find((m) => m.reasoning === true) ?? models[0])?.id;
export const registerOAuthProvider = async (auth: OAuthAuth, credential: OAuthCredential): Promise<void> => {
  const meta = PROVIDER_META[auth.id];
  if (!meta) throw new Error(`No registration metadata for OAuth provider "${auth.id}"`);
  await setCredential(auth.id, credential);
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
  options.providers = next.providers;
  if (next.harness) options.harness = next.harness;
};
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
export const repointModelKey = (
  modelKey: string,
  removedProviderId: string,
  providers: ProviderOptions[],
): string => {
  if (!modelKey.startsWith(`${removedProviderId}/`)) return modelKey;
  const first = providers[0];
  const model = first ? pickDefaultModel(first.models) ?? first.models[0]?.id : undefined;
  return first && model ? `${first.id}/${model}` : modelKey;
};
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
