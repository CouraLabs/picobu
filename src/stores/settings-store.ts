import { createStore } from "@xstate/store-react";
import { options, updateSettings, type Options, type OptionsExternal } from "../libs/options";
import { footerToastStore } from "./footer-toast-store";

export type SettingsState = {
  options: Options;
  error: string | null;
};

export const settingsStore = createStore({
  context: {
    options: { ...options } as Options,
    error: null,
  } as SettingsState,
  on: {
    hydrate: (s, e: { options: Options }) => ({ ...s, options: e.options, error: null }),
    setError: (s, e: { error: string | null }) => ({ ...s, error: e.error }),
  },
});

export async function saveSettings(
  patch: Partial<Pick<OptionsExternal, "providers" | "harness" | "theme" | "web">>,
): Promise<Options> {
  try {
    const next = await updateSettings(patch);
    Object.assign(options, next);
    settingsStore.trigger.hydrate({ options: next });
    footerToastStore.trigger.show({ message: "Saved!" });
    return next;
  } catch (err) {
    settingsStore.trigger.setError({ error: (err as Error).message });
    throw err;
  }
}
