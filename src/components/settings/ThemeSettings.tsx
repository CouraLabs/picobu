import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../stores/theme-store";
import { settingsStore, saveSettings } from "../../stores/settings-store";
import { allThemes } from "../../themes";
import { DropdownField } from "../ui/DropdownField";
import { useTheme } from "../../hooks/useTheme";

export const ThemeSettings = () => {
  const { theme } = useTheme();
  const opts = useSelector(settingsStore, (s) => s.context.options);
  const themeKeys = Object.keys(allThemes());
  const variantOptions = ["dark", "light"] as const;

  const currentKey = opts.theme?.key ?? themeKeys[0] ?? "tacos";
  const currentVariant = opts.theme?.variant === "light" ? "light" : "dark";
  const selectedThemeIdx = Math.max(0, themeKeys.indexOf(currentKey));
  const selectedVariantIdx = Math.max(0, variantOptions.indexOf(currentVariant as typeof variantOptions[number]));

  const persist = async (key: string, variant: "dark" | "light") => {
    await saveSettings({ theme: { key, variant } });
    const trigger = themeStore.trigger as unknown as { hydrate: (e: { key: string; variant: "dark" | "light" }) => void };
    trigger.hydrate({ key, variant });
  };

  return (
    <scrollbox flexGrow={1} backgroundColor={theme.backgroundPanel} contentOptions={{ paddingX: 2, paddingY: 1}}>
      <box flexDirection="row" gap={1} flexShrink={1}>
        <DropdownField
          flexGrow={0}
          title="Theme"
          height={Math.min(themeKeys.length, 12)}
          options={themeKeys.map((k) => ({ name: k, description: "", value: k }))}
          selectedIndex={selectedThemeIdx}
          onSelect={(_i, opt) => {
            const v = opt?.value;
            if (typeof v === "string") void persist(v, currentVariant);
          }}
        />
        <DropdownField
          title="Variant"
          flexGrow={0}
          height={2}
          options={variantOptions.map((v) => ({ name: v, description: "", value: v }))}
          selectedIndex={selectedVariantIdx}
          onSelect={(_i, opt) => {
            const v = opt?.value;
            if (v === "dark" || v === "light") void persist(currentKey, v);
          }}
        />
      </box>
    </scrollbox>
  );
};
