import type { Command } from "../types";
import { loopStore } from "../../../stores/loop-store";
import { footerToastStore } from "../../../stores/footer-toast-store";
import { oauthAuthById } from "../../../auth";
import { logoutOAuthProvider } from "../../../auth/register";

const fail = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * `/logout` — remove a provider login. No argument opens a picker of logged-in
 * providers; `/logout <provider>` removes the credential from auth.json, its
 * provider entry (the `auth:<id>` reference) from options.json, repoints any
 * harness model selectors away from it, and — when the removed provider was
 * the session's active model — switches the session to a remaining provider.
 */
export const logout: Command = {
  kind: "system",
  name: "logout",
  aliases: [],
  flags: ["code", "web"],
  title: "logout",
  description: "Remove a provider login (/logout <provider>)",
  path: "",
  handler: (args) => {
    const id = args.trim().split(/\s+/)[0] ?? "";
    if (id && oauthAuthById(id)) {
      void logoutOAuthProvider(id, loopStore.getSnapshot().context.modelKey)
        .then(({ removed, nextModelKey }) => {
          if (nextModelKey && nextModelKey !== loopStore.getSnapshot().context.modelKey) {
            loopStore.trigger.setModel({ modelKey: nextModelKey });
          }
          footerToastStore.trigger.show({
            message: removed ? `Logged out of ${id}` : `No login found for ${id}`,
          });
        })
        .catch((e) => footerToastStore.trigger.show({ message: `logout failed: ${fail(e)}` }));
      return;
    }
    loopStore.trigger.openAuthPicker({ mode: "logout" });
  },
};