import type { AuthInteraction, AuthNotifyEvent } from "@auth/types.ts";
import { openInBrowser } from "@libs/open-url.ts";

/**
 * Adapt a login flow's notifications to console output: progress/device-code/
 * auth-url events are logged and the URL (or verification URI) is opened in
 * the platform browser.
 */
export const createInteraction = (
  providerId: string,
  providerName: string,
  signal: AbortSignal,
): AuthInteraction => {
  const notify = (event: AuthNotifyEvent): void => {
    if (event.type === "auth_url") {
      console.log(`[${providerName}] ${event.instructions ?? "Complete login in your browser to finish."}`);
      openInBrowser(event.url);
    } else if (event.type === "device_code") {
      console.log(
        `[${providerName}] Approve the device login in your browser, then wait here.`,
      );
      if (event.userCode) console.log(`[${providerName}] Code: ${event.userCode}`);
      openInBrowser(event.verificationUri);
    } else if (event.type === "progress") {
      console.log(`[${providerName}] ${event.message}`);
    }
  };
  return { signal, notify };
};
