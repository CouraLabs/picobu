import type { AuthInteraction, AuthNotifyEvent } from "./types";
import { authStore } from "../stores/auth-store";
import { openInBrowser } from "../libs/open-url";

/**
 * Adapt a login flow's notifications to the global auth status dialog:
 * progress/device-code/auth-url events become store status updates and the
 * URL (or verification URI) is opened in the platform browser.
 */
export const createInteraction = (
  providerId: string,
  providerName: string,
  signal: AbortSignal,
): AuthInteraction => {
  const notify = (event: AuthNotifyEvent): void => {
    if (event.type === "auth_url") {
      authStore.trigger.progress({
        screen: "progress",
        providerId,
        providerName,
        message: event.instructions ?? "Complete login in your browser to finish.",
        url: event.url,
      });
      openInBrowser(event.url);
    } else if (event.type === "device_code") {
      authStore.trigger.progress({
        screen: "progress",
        providerId,
        providerName,
        message: "Approve the device login in your browser, then wait here.",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
      });
      openInBrowser(event.verificationUri);
    } else if (event.type === "progress") {
      authStore.trigger.progress({
        screen: "progress",
        providerId,
        providerName,
        message: event.message,
      });
    }
  };
  return { signal, notify };
};