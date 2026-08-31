import { useState, useRef } from "react";
import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/store-react";
import { settingsStore, saveSettings } from "../../stores/settings-store";
import { DEFAULT_WEB_OPTIONS } from "../../libs/options";
import { InputField } from "../ui/InputField";
import { useTheme } from "../../hooks/useTheme";

export const WebSettings = () => {
  const { theme } = useTheme();
  const opts = useSelector(settingsStore, (s) => s.context.options);
  const web = { ...DEFAULT_WEB_OPTIONS, ...opts.web };

  const [host, setHost] = useState(web.host);
  const [portStr, setPortStr] = useState(String(web.port));
  const [portError, setPortError] = useState<string | null>(null);
  const hostTimer = useRef<number | null>(null);
  const portTimer = useRef<number | null>(null);

  const saveHost = (v: string) => {
    clearTimeout(hostTimer.current as unknown as number);
    hostTimer.current = setTimeout(() => {
      void saveSettings({ web: { host: v, port: web.port } });
    }, 400) as unknown as number;
  };
  const savePort = (v: string) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 1 || n > 65535) {
      setPortError("Port must be 1–65535");
      return;
    }
    setPortError(null);
    clearTimeout(portTimer.current as unknown as number);
    portTimer.current = setTimeout(() => {
      void saveSettings({ web: { host, port: n } });
    }, 400) as unknown as number;
  };

  return (
    <scrollbox flexGrow={1} backgroundColor={theme.backgroundPanel} contentOptions={{ paddingX: 2, paddingY: 1}}>
      <box flexDirection="row" border borderStyle="single" borderColor={theme.border} title=" Web Server " titleColor={theme.textMuted} paddingX={1}>
        <InputField
          title="Host"
          value={host}
          placeholder="0.0.0.0"
          onChange={(v) => { setHost(v); saveHost(v); }}
        />
        <InputField
          title="Port"
          value={portStr}
          placeholder="8080"
          error={portError ?? undefined}
          onChange={(v) => { setPortStr(v); savePort(v); }}
        />
      </box>
    </scrollbox>
  );
};
