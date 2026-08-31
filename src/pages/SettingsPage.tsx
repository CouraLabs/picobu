import { useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/store-react";
import { useTheme } from "../hooks/useTheme";
import { settingsStore } from "../stores/settings-store";
import type { OptionsExternal } from "../libs/options";
import { ProviderSettings } from "../components/settings/ProviderSettings";
import { HarnessSettings } from "../components/settings/HarnessSettings";
import { ThemeSettings } from "../components/settings/ThemeSettings";
import { WebSettings } from "../components/settings/WebSettings";

const TABS: (keyof OptionsExternal)[] = ["providers", "harness", "theme", "web"];

export const SettingsPage = () => {
  const { theme } = useTheme();
  const { error } = useSelector(settingsStore, (s) => s.context);
  const [tab, setTab] = useState<keyof OptionsExternal>("providers");
  const [hoverTab, setHoverTab] = useState("");

  return (
    <box flexDirection="column" flexGrow={1} paddingX={1} gap={1}>
      <box flexDirection="row" gap={2} paddingY={1} paddingX={2} flexShrink={0} backgroundColor={theme.backgroundPanel}>
        {TABS.map((t) => (
          <box key={t} onMouseDown={() => setTab(t)} onMouseOver={() => setHoverTab(t)} onMouseOut={() => setHoverTab("")}>
            <text
              fg={hoverTab === t && tab !== t ? theme.accent : (tab === t ? theme.text : theme.textMuted)} 
              attributes={tab === t || hoverTab === t ? TextAttributes.BOLD : TextAttributes.DIM}>
              [{t}]
            </text>
          </box>
        ))}
      </box>
      {error && (
        <text fg={theme.error ?? theme.text}>{error}</text>
      )}
      {tab === "providers" && <ProviderSettings />}
      {tab === "harness" && <HarnessSettings />}
      {tab === "theme" && <ThemeSettings />}
      {tab === "web" && <WebSettings />}
    </box>
  );
};
