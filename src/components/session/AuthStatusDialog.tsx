import { useEffect } from "react";
import { useSelector } from "@xstate/store-react";
import { TextAttributes } from "@opentui/core";
import { themeStore } from "../../stores/theme-store";
import { authStore } from "../../stores/auth-store";
import { cancelLogin } from "../../auth";
import { Button } from "../ui/Button";

const SUCCESS_MS = 4000;
const ERROR_MS = 15_000;

/**
 * Global OAuth status dialog: shows the auth URL / device code while a
 * `/login` flow runs (Cancel aborts it), the outcome, or an error. The browser
 * is opened by the flow's interaction adapter, not here. Success/error
 * auto-dismiss after a beat so the prompt stays usable.
 */
export const AuthStatusDialog = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const status = useSelector(authStore, (s) => s.context.status);

  useEffect(() => {
    if (status.screen !== "success" && status.screen !== "error") return;
    const id = setTimeout(() => authStore.trigger.dismiss(), status.screen === "success" ? SUCCESS_MS : ERROR_MS);
    return () => clearTimeout(id);
  }, [status]);

  if (status.screen === "idle") return null;

  const title =
    status.screen === "progress" ? ` ${status.providerName} login ` : ` ${status.providerName} `;

  return (
    <box border borderStyle="single" title={title} titleColor={theme.accent} borderColor={theme.accent}>
      <box flexDirection="column" paddingX={1} gap={1}>
        <text fg={theme.text}>{status.message}</text>
        {status.screen === "progress" && status.userCode ? (
          <text fg={theme.warning} attributes={TextAttributes.BOLD}>
            {status.userCode}
          </text>
        ) : null}
        {status.screen === "progress" &&
        status.verificationUri &&
        status.verificationUri !== (status.url ?? "") ? (
          <text fg={theme.textMuted}>{status.verificationUri}</text>
        ) : null}
        {status.screen === "progress" && status.url ? (
          <text fg={theme.textMuted}>Browser opened — complete login there.</text>
        ) : null}
        <box flexDirection="row" justifyContent="flex-end">
          {status.screen === "progress" ? (
            <Button variant="warning" onPress={cancelLogin}>
              Cancel
            </Button>
          ) : (
            <Button variant={status.screen === "error" ? "error" : "success"} onPress={() => authStore.trigger.dismiss()}>
              {status.screen === "error" ? "Dismiss" : "OK"}
            </Button>
          )}
        </box>
      </box>
    </box>
  );
};