import type { AuthInteraction, AuthNotifyEvent } from "@auth/types.ts";
import { openInBrowser } from "@shared/open-url.ts";


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
