import { createStore } from "@xstate/store-react";

export type AuthStatus = { screen: "idle" } | AuthProgress | AuthTerminal;

export type AuthProgress = {
  screen: "progress";
  providerId: string;
  providerName: string;
  message: string;
  detail?: string;
  url?: string;
  userCode?: string;
  verificationUri?: string;
};

export type AuthTerminal = {
  screen: "success" | "error";
  providerId: string;
  providerName: string;
  message: string;
  detail?: string;
};

export type AuthState = { status: AuthStatus };

/**
 * Single global slot for the OAuth login/logout status dialog. The flows push
 * progress/device-code/auth-url events here; `AuthStatusDialog` renders them
 * and wires Cancel to the active login's AbortController.
 */
export const authStore = createStore({
  context: { status: { screen: "idle" } } as AuthState,
  on: {
    progress: (
      _s,
      e: {
        screen: "progress";
        providerId: string;
        providerName: string;
        message: string;
        detail?: string;
        url?: string;
        userCode?: string;
        verificationUri?: string;
      },
    ) => ({ status: e } satisfies AuthState),
    success: (
      _s,
      e: { screen: "success"; providerId: string; providerName: string; message: string; detail?: string },
    ) => ({ status: e } satisfies AuthState),
    error: (
      _s,
      e: { screen: "error"; providerId: string; providerName: string; message: string; detail?: string },
    ) => ({ status: e } satisfies AuthState),
    dismiss: () => ({ status: { screen: "idle" } } satisfies AuthState),
  },
});