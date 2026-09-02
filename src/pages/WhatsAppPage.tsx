import { useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useSelector } from "@xstate/store-react";
import { ErrorCorrectionLevel } from "@opentui/qrcode";
import { Button } from "../components/ui/Button";
import { icons } from "../components/symbols/icons";
import { InputField } from "../components/ui/InputField";
import { useTheme } from "../hooks/useTheme";
import { whatsappStore } from "../integrations/whatsapp/whatsapp-store";
import {
  connectToWhatsApp,
  disconnectFromWhatsApp,
  requestPairingCode,
} from "../integrations/whatsapp/connection";
import { options } from "../libs/options";
import { formatLocalTime } from "../cron/schedule";

export const WhatsAppPage = () => {
  const { theme } = useTheme();
  const dims = useTerminalDimensions();
  const { status, qr, pairingCode, jid, error, log } = useSelector(whatsappStore, (s) => s.context);
  const allowed = options.whatsapp.allowedNumbers;
  const [phone, setPhone] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);
  // A Baileys QR is a ~65x65-module symbol (~33 half-block rows) and the
  // renderable only draws its fallback below that, so below this terminal
  // size we hide the QR box and push the pairing-code form instead
  // (thresholds measured against the real app chrome).
  const qrFits = dims.height >= 54 && dims.width >= 82;

  const statusColor = () => {
    switch (status) {
      case "connected": return theme.success;
      case "error": return theme.error;
      case "awaiting-qr": return theme.warning;
      case "connecting": return theme.info;
      default: return theme.textMuted;
    }
  };

  const requestPairCode = (): void => {
    setPairError(null);
    requestPairingCode(phone).catch((e: unknown) => {
      setPairError(e instanceof Error ? e.message : String(e));
    });
  };

  return (
    <box id="whatsapp-page" flexDirection="column" flexGrow={1} paddingX={2} gap={1}>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>WhatsApp</text>
        <text fg={statusColor()} selectable={false}>{status.toUpperCase()}</text>
        {jid ? <text fg={theme.textMuted}>{jid}</text> : null}
        <box flexGrow={1} />
        <Button
          variant={status === "connected" ? "error" : "success"}
          onPress={() => (status === "connected" ? disconnectFromWhatsApp() : void connectToWhatsApp())}
        >
          {status === "connected" ? "Disconnect" : "Connect"}
        </Button>
      </box>
      {qr && qrFits ? (
        <box
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          flexGrow={1}
          flexShrink={1}
          border
          borderStyle="rounded"
          borderColor={theme.border}
          titleColor={theme.textMuted}
          title={` Scan in WhatsApp ${icons.arrows.right} Linked devices `}
        >
          <qr-code
            content={qr}
            scale={1}
            quietZone={4}
            fit="contain"
            errorCorrectionLevel={ErrorCorrectionLevel.L}
            fallbackContent="Terminal too small for the QR code — pair with the code below"
            fallbackColor={theme.textMuted}
          />
        </box>
      ) : null}
      {qr && !qrFits ? (
        <text fg={theme.textMuted}>
          QR pairing needs a taller window (≥ ~53 rows) — pair with the code below instead, or enlarge the window.
        </text>
      ) : null}
      <box flexDirection="column" flexShrink={0} height={status === "connected" ? 16 : 8} gap={1}>
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted} flexGrow={1}>
            Allowed: {allowed.length ? allowed.map((n) => `+${n}`).join(", ") : "(none — set whatsapp.allowedNumbers)"}
          </text>
          {error ? <text fg={theme.error}>{error}</text> : null}
        </box>
        {status === "connected" ? (
          <>
            <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>Activity</text>
            <scrollbox scrollY flexGrow={1} flexShrink={1}>
              {log.slice(-40).map((entry) => (
                <text key={`${entry.at}-${entry.message}`} fg={theme.textMuted} selectable={false}>
                  {formatLocalTime(entry.at)}  {entry.message}
                </text>
              ))}
            </scrollbox>
          </>
        ) : null}
        {pairingCode ? (
          <text fg={theme.warning} attributes={TextAttributes.BOLD}>
            Pairing code: {pairingCode.length === 8 ? `${pairingCode.slice(0, 4)}-${pairingCode.slice(4)}` : pairingCode}
          </text>
        ) : null}
        {status !== "connected" ? (
          <box flexDirection="row" gap={1} alignItems="flex-end" flexShrink={0}>
            <InputField
              title="Pair with phone number (digits, with country code)"
              value={phone}
              placeholder="15551234567"
              error={pairError ?? undefined}
              onChange={setPhone}
              flexGrow={1}
            />
            <Button variant="info" onPress={requestPairCode}>
              Pair with code
            </Button>
          </box>
        ) : null}
      </box>
    </box>
  );
};
