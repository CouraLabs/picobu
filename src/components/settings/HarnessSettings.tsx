import { useSelector } from "@xstate/store-react";
import { settingsStore, saveSettings } from "../../stores/settings-store";
import { listModels } from "../../harness/agent/factory/provider-resolver";
import { THINKING_LEVELS } from "../../stores/loop-store";
import { DropdownField } from "../ui/DropdownField";
import { useTheme } from "../../hooks/useTheme";

const THINKING_OPTIONS = THINKING_LEVELS as string[];

export const HarnessSettings = () => {
  const { theme } = useTheme();
  const opts = useSelector(settingsStore, (s) => s.context.options);
  const harness = opts.harness ?? {};
  const modelRoles = (harness.modelRoles ?? {}) as Record<string, string | undefined>;

  // Need fresh list each render - but listModels reads options singleton which is hydrated via saveSettings
  const models = listModels();
  const modelKeys = models.map((m) => m.key);
  const modelOptions = modelKeys.map((k) => ({ name: k, description: "", value: k }));

  const saveDefaultModel = (v: string) => {
    void saveSettings({ harness: { defaultModel: v } as unknown as Record<string, unknown> as never });
  };

  const saveRole = (role: string, value: string | undefined) => {
    const currentRoles = (settingsStore.getSnapshot().context.options.harness?.modelRoles ?? {}) as Record<string, string | undefined>;
    const nextRoles = { ...currentRoles };
    if (value) nextRoles[role] = value;
    else delete nextRoles[role];
    void saveSettings({ harness: { modelRoles: nextRoles } as unknown as Record<string, unknown> as never });
  };

  if (modelKeys.length === 0) {
    return (
      <box flexDirection="column" gap={1} paddingY={1}>
        <text fg={theme.error}>No providers configured — add one in Providers tab</text>
      </box>
    );
  }

  const roles: { id: string; label: string; isThinking: boolean }[] = [
    { id: "tiny", label: "Tiny", isThinking: false },
    { id: "flash", label: "Flash", isThinking: false },
    { id: "flashThinking", label: "Flash Thinking Level", isThinking: true },
    { id: "heavy", label: "Heavy", isThinking: false },
    { id: "heavyThinkingLevel", label: "Heavy Thinking Level", isThinking: true },
  ];

  const defaultIdx = harness.defaultModel ? modelKeys.indexOf(harness.defaultModel) : -1;

  return (
    <scrollbox backgroundColor={theme.backgroundPanel} contentOptions={{ paddingX: 2, paddingY: 1}}>
      <DropdownField
        flexGrow={0}
        title="Default Model"
        height={Math.min(modelKeys.length, 12)}
        options={modelOptions}
        selectedIndex={Math.max(0, defaultIdx)}
        onSelect={(_i, opt) => {
          const v = opt?.value;
          if (typeof v === "string") saveDefaultModel(v);
        }}
      />
      <box flexDirection="row" gap={1} flexWrap="wrap" border borderStyle="single" borderColor={theme.border} title=" Role Overrides " titleColor={theme.text}>
        {roles.map((role) => {
          const opts_with_empty = role.isThinking
            ? [{ name: "(inherit)", description: "", value: "" }, ...THINKING_OPTIONS.map((t) => ({ name: t, description: "", value: t }))]
            : [{ name: "(use default)", description: "", value: "" }, ...modelOptions];
          const cur = modelRoles[role.id] ?? "";
          const idx = opts_with_empty.findIndex((o) => o.value === cur);
          return (
            <DropdownField
              flexGrow={1}
              key={role.id}
              title={role.label}
              height={Math.min(opts_with_empty.length, 12)}
              options={opts_with_empty}
              selectedIndex={Math.max(0, idx)}
              onSelect={(_i, opt) => {
                const v = opt?.value;
                saveRole(role.id, typeof v === "string" && v ? v : undefined);
              }}
            />
          );
        })}
      </box>
    </scrollbox>
  );
};
