import { useState, useRef } from "react";
import { useSelector } from "@xstate/store-react";
import { TextAttributes } from "@opentui/core";
import { themeStore } from "../../stores/theme-store";
import { settingsStore, saveSettings } from "../../stores/settings-store";
import type { ProviderOptions, ProviderModelOptions } from "../../libs/options";
import { ProviderForm } from "./ProviderForm";
import { icons } from "../symbols/icons";
import { Button } from "../ui/Button";

export const ProviderSettings = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const opts = useSelector(settingsStore, (s) => s.context.options);
  const providers = opts.providers ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(providers[0]?.id ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selected = providers.find((p) => p.id === selectedId) ?? null;

  const onAdd = async () => {
    const id = `provider-${Date.now()}`;
    const newProvider: ProviderOptions = {
      id,
      name: "New Provider",
      type: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      models: [],
    };
    const next = [...providers, newProvider];
    await saveSettings({ providers: next });
    setSelectedId(id);
    setConfirmDelete(false);
  };

  const onDelete = async () => {
    if (!selectedId) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 5000);
      return;
    }
    const next = providers.filter((p) => p.id !== selectedId);
    await saveSettings({ providers: next });
    setSelectedId(next[0]?.id ?? null);
    setConfirmDelete(false);
  };

  const onSave = async (updated: ProviderOptions) => {
    // handle id rename: patch harness references
    const oldId = selectedId;
    const isIdChange = oldId && updated.id !== oldId;
    // validate unique id
    if (providers.some((p) => p.id === updated.id && p.id !== oldId)) return;
    let nextProviders = providers.map((p) => (p.id === oldId ? updated : p));
    // if id changed, also patch harness model keys
    if (isIdChange && oldId) {
      const harness = settingsStore.getSnapshot().context.options.harness;
      if (harness) {
        const patch: Record<string, unknown> = {};
        let needsPatch = false;
        const roles = harness.modelRoles ?? {};
        const nextRoles: Record<string, string | undefined> = { ...roles };
        for (const [k, v] of Object.entries(nextRoles)) {
          if (typeof v === "string" && v.startsWith(oldId + "/")) {
            nextRoles[k] = v.replace(oldId + "/", updated.id + "/");
            needsPatch = true;
          }
        }
        if (needsPatch) patch["modelRoles"] = nextRoles;
        if (harness.defaultModel?.startsWith(oldId + "/")) {
          patch["defaultModel"] = harness.defaultModel.replace(oldId + "/", updated.id + "/");
          needsPatch = true;
        }
        if (needsPatch) {
          await saveSettings({ providers: nextProviders, harness: patch as never });
          setSelectedId(updated.id);
          return;
        }
      }
    }
    await saveSettings({ providers: nextProviders });
    if (isIdChange) setSelectedId(updated.id);
  };

  return (
    <box flexDirection="row" flexGrow={1} gap={2}>
      <box width={20} flexDirection="column" flexShrink={0} backgroundColor={theme.backgroundPanel}>
        <scrollbox flexGrow={1} contentOptions={{paddingX: 2, paddingY: 1}}>
          {providers.length === 0 ? (
            <text fg={theme.textMuted}>No providers</text>
          ) : (
            providers.map((p) => (
              <box key={p.id} onMouseDown={() => { setSelectedId(p.id); setConfirmDelete(false); }}>
                <text fg={p.id === selectedId ? theme.accent : theme.text} attributes={p.id === selectedId ? TextAttributes.BOLD : TextAttributes.DIM}>
                  {icons.arrows.rightChevron} {p.name}
                </text>
              </box>
            ))
          )}
        </scrollbox>
        <box flexDirection="row" justifyContent="space-evenly" alignItems="space-evenly" flexShrink={0}>
          <Button onPress={() => void onAdd()}>Add</Button>
          <Button variant="error" onPress={() => void onDelete()}>Delete</Button>
        </box>
        {confirmDelete && selected && (
          <text fg={theme.error}>Confirm delete {selected.name}? (click Delete again)</text>
        )}
      </box>
      <box flexGrow={1} flexDirection="column" gap={1} paddingX={2} paddingY={1} titleColor={theme.textMuted} backgroundColor={theme.backgroundPanel}>
        {selected ? (
          <ProviderForm key={selected.id} provider={selected} onSave={onSave} />
        ) : (
          <text fg={theme.textMuted}>Select or add a provider</text>
        )}
      </box>
    </box>
  );
};
