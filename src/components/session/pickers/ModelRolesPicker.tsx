import { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "@xstate/store-react";
import type { SelectRenderable } from "@opentui/core";
import { loopStore } from "../../../stores/loop-store";
import { settingsStore, saveSettings } from "../../../stores/settings-store";
import { themeStore } from "../../../stores/theme-store";
import { resolveModelRole } from "../../../libs/options";
import { DEFAULT_AGENT_ROLE } from "../../../harness/agent/factory/agent/registry";
import { icons } from "../../symbols/icons";
import { modelEntries, roleModelRows, type RoleModelId } from "./ModelRoles";
import { describe, sortByPrice } from "./ModelPicker";

/**
 * `/model-roles` picker, opened from the loop store. Two steps: pick a model
 * role (tiny/flash/heavy) showing its current assignment + thinking default,
 * then pick a model from every configured provider. The selection is saved via
 * `saveSettings` (settings store → options.json under lock), so only that
 * role's `harness.modelRoles` entry changes and the rest survive.
 */
export const ModelRolesPicker = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const rolePickerOpen = useSelector(loopStore, (s) => s.context.rolePickerOpen);
  const harness = useSelector(settingsStore, (s) => s.context.options.harness);
  const providers = useSelector(settingsStore, (s) => s.context.options.providers);
  const [step, setStep] = useState<"role" | "model">("role");
  const [selectedRole, setSelectedRole] = useState<RoleModelId>("tiny");
  const selectRef = useRef<SelectRenderable>(null);

  // Fresh per settings change (the settings store hydrates after saves).
  const roles = useMemo(() => roleModelRows(harness), [harness]);
  const models = useMemo(() => modelEntries(providers).slice().sort(sortByPrice), [providers]);

  // Reset back to the role step whenever the picker (re)opens.
  useEffect(() => {
    if (!rolePickerOpen) return;
    setStep("role");
    setSelectedRole("tiny");
  }, [rolePickerOpen]);

  // The focused select owns the keyboard while the picker is open.
  useEffect(() => {
    if (!rolePickerOpen) return;
    const id = setTimeout(() => selectRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [rolePickerOpen, step]);

  if (!rolePickerOpen) return null;

  const roleOptions = roles.map((r) => ({
    name: r.label,
    description: `${r.assignedKey ?? "unassigned"}${r.defaultThinking ? ` · thinking: ${r.defaultThinking}` : ""}`,
    value: r.role,
  }));

  const assignedKey = roles.find((r) => r.role === selectedRole)?.assignedKey;
  const modelOptions = models.map((m) => ({
    name: `${m.providerName} ${m.modelName}`,
    description: describe(m),
    value: m.key,
  }));
  const selectedIndex = Math.max(0, models.findIndex((m) => m.key === assignedKey));

  const selectProps = {
    ref: selectRef,
    showScrollIndicator: true,
    textColor: theme.text,
    focusedTextColor: theme.text,
    selectedTextColor: theme.accent,
    descriptionColor: theme.textMuted,
    selectedDescriptionColor: theme.accent,
    backgroundColor: "transparent",
    focusedBackgroundColor: "transparent",
    selectedBackgroundColor: "transparent",
  } as const;

  return (
    <box
      border
      borderStyle="single"
      borderColor={theme.border}
      title={step === "role" ? " Model Roles " : ` Assign ${icons.arrows.right} ${selectedRole} `}
      titleColor={theme.textMuted}
    >
      {step === "role" ? (
        <select
          {...selectProps}
          height={Math.min(roles.length, 5) * 2}
          options={roleOptions}
          selectedIndex={0}
          onSelect={(_index, option) => {
            if (option && typeof option.value === "string") {
              setSelectedRole(option.value as RoleModelId);
              setStep("model");
            }
          }}
        />
      ) : (
        <select
          {...selectProps}
          height={Math.min(models.length, 5) * 2}
          options={modelOptions}
          selectedIndex={selectedIndex}
          onSelect={(_index, option) => {
            if (!option || typeof option.value !== "string") return;
            const value = option.value;
            // The picker stays open until the save settles: a failed write
            // (lock contention, disk error) keeps it open to retry.
            void saveSettings({ harness: { modelRoles: { [selectedRole]: value } } })
              .then((next) => {
                // Live update: if the active agent runs on the role just
                // assigned, apply it to the loop so the next prepareCall step
                // uses the new model immediately.
                if (DEFAULT_AGENT_ROLE[loopStore.getSnapshot().context.agentId] !== selectedRole) return;
                const resolved = resolveModelRole(next.harness, selectedRole);
                loopStore.trigger.setModel({ modelKey: resolved.modelKey });
                if (resolved.thinking) loopStore.trigger.setThinking({ thinking: resolved.thinking });
              })
              .then(() => loopStore.trigger.closeRolePicker())
              .catch(() => {}); // failure keeps the picker open; saveSettings surfaced the error
          }}
        />
      )}
    </box>
  );
};