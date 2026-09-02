import {
  resolveModelRole,
  type HarnessOptions,
  type ProviderModelBilling,
  type ProviderModelReasoningEffort,
  type ProviderOptions,
} from "../../libs/options";
import type { ModelEntry } from "../../harness/agent/factory/provider-resolver";

/** The roles that hold a `<providerId>/<modelId>` selector. */
export type RoleModelId = "tiny" | "flash" | "heavy";

export const ROLE_MODEL_IDS: RoleModelId[] = ["tiny", "flash", "heavy"];

export type RoleRow = {
  role: RoleModelId;
  label: string;
  assignedKey: string | undefined;
  defaultThinking: ProviderModelReasoningEffort | undefined;
};

/**
 * Resolve the current assignment + effective thinking default for every model
 * role. Assignment falls back to `harness.defaultModel`; a model-less config
 * degrades to `undefined` instead of throwing (the picker stays usable).
 */
export function roleModelRows(harness: HarnessOptions | undefined): RoleRow[] {
  return ROLE_MODEL_IDS.map((role) => {
    let defaultThinking: ProviderModelReasoningEffort | undefined;
    try {
      defaultThinking = resolveModelRole(harness, role).thinking;
    } catch {
      defaultThinking = undefined;
    }
    return {
      role,
      label: role,
      assignedKey: harness?.modelRoles?.[role] ?? harness?.defaultModel,
      defaultThinking,
    };
  });
}

/**
 * Model entries derived from a providers list (the settings-store copy), so
 * the picker stays in sync with live settings instead of the module singleton.
 * Mirrors the `ModelEntry` shape of `provider-resolver.listModels()`.
 */
export function modelEntries(providers: ProviderOptions[]): ModelEntry[] {
  return providers.flatMap((p) =>
    p.models.map((m): ModelEntry => {
      const billing: ProviderModelBilling | undefined = m.billing;
      return {
        key: `${p.id}/${m.id}`,
        providerId: p.id,
        providerName: p.name,
        modelId: m.id,
        modelName: m.name ?? m.id,
        supports: m.supports ?? [],
        context: m.context,
        output: m.output,
        billing,
      };
    }),
  );
}