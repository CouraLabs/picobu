import { useEffect, useRef } from "react";
import { useSelector } from "@xstate/store-react";
import type { SelectRenderable } from "@opentui/core";
import { themeStore } from "../../stores/theme-store";
import { loopStore } from "../../stores/loop-store";
import { footerToastStore } from "../../stores/footer-toast-store";
import { listOAuthProviders, startLogin } from "../../auth";
import { logoutOAuthProvider } from "../../auth/register";

const fail = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * OAuth provider picker, opened by `/login` (no arg) and `/logout` (no arg).
 * Login mode lists every provider with its login state; logout mode lists only
 * providers with stored credentials. Selection runs the flow, then closes.
 */
export const AuthPicker = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const { authPickerOpen, authPickerMode } = useSelector(loopStore, (s) => s.context);
  const selectRef = useRef<SelectRenderable>(null);

  useEffect(() => {
    if (!authPickerOpen) return;
    const id = setTimeout(() => selectRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [authPickerOpen]);

  if (!authPickerOpen) return null;

  const providers = listOAuthProviders();
  const options = providers
    .filter((p) => (authPickerMode === "logout" ? p.loggedIn : true))
    .map((p) => ({
      name: p.name,
      description:
        authPickerMode === "logout"
          ? "Remove this login and its registered models"
          : p.loggedIn
            ? "Already logged in — selecting refreshes the login"
            : "Not logged in",
      value: p.id,
    }));
  if (options.length === 0) return null;

  return (
    <box
      border
      borderStyle="single"
      title={` ${authPickerMode === "login" ? "Login" : "Logout"} Provider `}
      titleColor={theme.text}
      borderColor={theme.border}
    >
      <select
        ref={selectRef}
        height={Math.min(options.length, 5) * 2}
        showScrollIndicator
        options={options}
        selectedIndex={0}
        textColor={theme.text}
        focusedTextColor={theme.text}
        selectedTextColor={theme.selectedListItemText}
        descriptionColor={theme.textMuted}
        selectedDescriptionColor={theme.textMuted}
        backgroundColor="transparent"
        focusedBackgroundColor="transparent"
        selectedBackgroundColor="transparent"
        onSelect={(_index, option) => {
          if (option && typeof option.value === "string") {
            if (authPickerMode === "login") {
              void startLogin(option.value);
            } else {
              void logoutOAuthProvider(option.value, loopStore.getSnapshot().context.modelKey)
                .then(({ removed, nextModelKey }) => {
                  if (nextModelKey && nextModelKey !== loopStore.getSnapshot().context.modelKey) {
                    loopStore.trigger.setModel({ modelKey: nextModelKey });
                  }
                  footerToastStore.trigger.show({
                    message: removed ? `Logged out of ${option.value}` : `No login found for ${option.value}`,
                  });
                })
                .catch((e) => footerToastStore.trigger.show({ message: `logout failed: ${fail(e)}` }));
            }
          }
          loopStore.trigger.closeAuthPicker();
        }}
      />
    </box>
  );
};