import { useState, useEffect, useRef } from "react";
import { TextAttributes } from "@opentui/core";
import { useSelector } from "@xstate/store-react";
import { settingsStore } from "../../stores/settings-store";
import type { ProviderOptions, ProviderModelOptions } from "../../libs/options";
import { THINKING_LEVELS } from "../../stores/loop-store";
import { InputField } from "../ui/InputField";
import { DropdownField } from "../ui/DropdownField";
import { Button } from "../ui/Button";
import { icons } from "../symbols/icons";
import { useTheme } from "../../hooks/useTheme";

const PROVIDER_TYPES = ["openai-compatible", "openai-responses", "anthropic"];

export const ProviderForm = ({
  provider,
  onSave,
}: {
  provider: ProviderOptions;
  onSave: (p: ProviderOptions) => void;
}) => {
  const { theme } = useTheme();
  const allProviders = useSelector(
    settingsStore,
    (s) => s.context.options.providers ?? [],
  );
  const [draft, setDraft] = useState<ProviderOptions>(provider);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedModelId, setSelectedModelId] = useState<string | null>(
    provider.models[0]?.id ?? null,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    setDraft(provider);
    setSelectedModelId(provider.models[0]?.id ?? null);
  }, [provider.id]);

  const validate = (d: ProviderOptions): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!d.id.trim()) e["id"] = "id required";
    else if (allProviders.some((p) => p.id === d.id && p.id !== provider.id))
      e["id"] = "id must be unique";
    if (!d.baseUrl.trim()) e["baseUrl"] = "baseUrl required";
    else {
      try {
        new URL(d.baseUrl);
      } catch {
        e["baseUrl"] = "invalid URL";
      }
    }
    const modelIds = new Set<string>();
    for (const m of d.models) {
      if (!m.id.trim()) e[`model-${m.id}-id`] = "model id required";
      if (modelIds.has(m.id)) e[`model-${m.id}-dup`] = "duplicate model id";
      modelIds.add(m.id);
      if (m.context < 1) e[`model-${m.id}-context`] = "context >= 1";
      if (m.output < 1) e[`model-${m.id}-output`] = "output >= 1";
    }
    return e;
  };

  const scheduleSave = (next: ProviderOptions) => {
    const errs = validate(next);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSave(next), 350);
  };

  const update = (patch: Partial<ProviderOptions>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    scheduleSave(next);
  };

  const updateModel = (
    modelId: string,
    patch: Partial<ProviderModelOptions>,
  ) => {
    const nextModels = draft.models.map((m) =>
      m.id === modelId ? { ...m, ...patch } : m,
    );
    const next = { ...draft, models: nextModels };
    setDraft(next);
    scheduleSave(next);
  };

  const addModel = () => {
    const newModel: ProviderModelOptions = {
      id: "new-model",
      name: "New Model",
      context: 128000,
      output: 4096,
    };
    let id = newModel.id;
    let n = 1;
    while (draft.models.some((m) => m.id === id)) {
      id = `new-model-${n++}`;
      newModel.id = id;
    }
    const next = { ...draft, models: [...draft.models, newModel] };
    setDraft(next);
    setSelectedModelId(newModel.id);
    scheduleSave(next);
  };

  const removeModel = (modelId: string) => {
    const next = {
      ...draft,
      models: draft.models.filter((m) => m.id !== modelId),
    };
    setDraft(next);
    if (selectedModelId === modelId)
      setSelectedModelId(next.models[0]?.id ?? null);
    scheduleSave(next);
  };

  const [headerKey, setHeaderKey] = useState("");
  const [headerValue, setHeaderValue] = useState("");

  const addHeader = () => {
    if (!headerKey.trim()) return;
    const next = {
      ...draft,
      headers: { ...(draft.headers ?? {}), [headerKey.trim()]: headerValue },
    };
    setDraft(next);
    setHeaderKey("");
    setHeaderValue("");
    scheduleSave(next);
  };
  const removeHeader = (k: string) => {
    const h = { ...(draft.headers ?? {}) };
    delete h[k];
    const next = { ...draft, headers: Object.keys(h).length ? h : undefined };
    setDraft(next);
    scheduleSave(next);
  };

  const selectedModel =
    draft.models.find((m) => m.id === selectedModelId) ?? null;

  return (
    <scrollbox flexGrow={1}>
      <box flexDirection="column">
        <box flexDirection="row" gap={1}>
          <InputField
            title="Id"
            value={draft.id}
            placeholder="provider id"
            error={errors["id"]}
            onChange={(v) => update({ id: v.replace(/[\s"']/g, "") })}
          />
          <InputField
            title="Name"
            value={draft.name}
            placeholder="Provider Name"
            onChange={(v) => update({ name: v })}
          />
          <DropdownField
            title="Type"
            height={PROVIDER_TYPES.length}
            options={PROVIDER_TYPES.map((t) => ({
              name: t,
              description: "",
              value: t,
            }))}
            selectedIndex={Math.max(0, PROVIDER_TYPES.indexOf(draft.type))}
            onSelect={(_i, opt) => {
              const v = opt?.value;
              if (typeof v === "string") update({ type: v });
            }}
          />
        </box>
        <InputField
          title="Base Url"
          value={draft.baseUrl}
          placeholder="https://api.openai.com/v1"
          error={errors["baseUrl"]}
          onChange={(v) => update({ baseUrl: v })}
        />
        <InputField
          title="API Key"
          value={draft.apiKey ?? ""}
          placeholder="env:OPENAI_API_KEY or sk-..."
          onChange={(v) => update({ apiKey: v || undefined })}
        />
        {draft.headers &&
          Object.entries(draft.headers).map(([k, v]) => (
            <box key={k} flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.text} flexGrow={1}>
                {k}: {String(v)}
              </text>
              <Button
                variant="error"
                bordered={false}
                onPress={() => removeHeader(k)}
              >
                Remove
              </Button>
            </box>
          ))}
        <box
          flexDirection="row"
          gap={1}
          focusable={true}
          titleColor={theme.textMuted}
          focusedBorderColor={theme.borderActive}
          flexGrow={1}
          border
          borderStyle="rounded"
          borderColor={theme.border}
          title={` Headers (${Object.keys(draft.headers ?? {}).length}) `}
          paddingX={1}
        >
          <InputField
            title="Key"
            value={headerKey}
            placeholder="Set header key"
            focusedBorderColor={theme.secondary}
            onChange={setHeaderKey}
          />
          <InputField
            title="Value"
            value={headerValue}
            placeholder="Set Header Value"
            focusedBorderColor={theme.secondary}
            onChange={setHeaderValue}
          />
          <Button bordered={true} onPress={addHeader}>
            Add Header
          </Button>
        </box>
      </box>
      <box
        flexDirection="column"
        gap={1}
        focusable={true}
        titleColor={theme.textMuted}
        focusedBorderColor={theme.borderActive}
        flexGrow={1}
        border
        borderStyle="rounded"
        borderColor={theme.border}
        title={` Models (${draft.models.length}) `}
        paddingX={1}
      >
        {draft.models.length > 0 && (
          <box flexDirection="row">
            <box flexDirection="column" flexShrink={0}>
              {draft.models.map((m) => (
                <box key={m.id} onMouseDown={() => setSelectedModelId(m.id)}>
                  <text
                    fg={m.id === selectedModelId ? theme.accent : theme.text}
                    attributes={
                      m.id === selectedModelId
                        ? TextAttributes.BOLD
                        : TextAttributes.DIM
                    }
                  >
                    {icons.arrows.rightChevron} {m.name} ({m.id}) {" "}
                  </text>
                </box>
              ))}
            </box>
            {selectedModel && (
              <box key={selectedModel.id} flexDirection="column" flexGrow={1}>
                <box flexDirection="row" gap={1}>
                  <InputField
                    title="Model Id"
                    flexBasis={0}
                    value={selectedModel.id}
                    error={
                      errors[`model-${selectedModel.id}-id`] ??
                      errors[`model-${selectedModel.id}-dup`]
                    }
                    onChange={(v) => updateModel(selectedModel.id, { id: v.replace(/[\s"']/g, "") })}
                  />
                  <InputField
                    title="Name"
                    flexBasis={0}
                    value={selectedModel.name}
                    onChange={(v) =>
                      updateModel(selectedModel.id, { name: v })
                    }
                  />
                </box>
                <box flexDirection="row" gap={1}>
                  <InputField
                    title="Context"
                    flexBasis={0}
                    value={String(selectedModel.context)}
                    error={errors[`model-${selectedModel.id}-context`]}
                    onChange={(v) => {
                      const n = parseInt(v, 10);
                      if (!isNaN(n))
                        updateModel(selectedModel.id, { context: n });
                    }}
                  />
                  <InputField
                    title="Output"
                    flexBasis={0}
                    value={String(selectedModel.output)}
                    error={errors[`model-${selectedModel.id}-output`]}
                    onChange={(v) => {
                      const n = parseInt(v, 10);
                      if (!isNaN(n))
                        updateModel(selectedModel.id, { output: n });
                    }}
                  />
                </box>
                <box flexDirection="row" gap={1}>
                  <InputField
                    title="Supports (comma-separated)"
                    flexBasis={0}
                    value={(selectedModel.supports ?? []).join(",")}
                    onChange={(v) =>
                      updateModel(selectedModel.id, {
                        supports: v
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                  <InputField
                    title="Efforts (comma-separated)"
                    flexBasis={0}
                    value={(selectedModel.efforts ?? []).join(",")}
                    onChange={(v) =>
                      updateModel(selectedModel.id, {
                        efforts: v
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </box>
                <box flexDirection="row" gap={1} alignItems="flex-start">
                  <DropdownField
                    title="Reasoning"
                    flexBasis={0}
                    height={2}
                    options={[
                      { name: "No", description: "", value: "false" },
                      { name: "Yes", description: "", value: "true" },
                    ]}
                    selectedIndex={selectedModel.reasoning ? 1 : 0}
                    onSelect={(_i, opt) =>
                      updateModel(selectedModel.id, {
                        reasoning: opt?.value === "true",
                      })
                    }
                  />
                  <DropdownField
                    title="Default Effort"
                    flexBasis={0}
                    height={Math.min(THINKING_LEVELS.length, 12)}
                    options={THINKING_LEVELS.map((t) => ({
                      name: t,
                      description: "",
                      value: t,
                    }))}
                    selectedIndex={Math.max(
                      0,
                      THINKING_LEVELS.indexOf(
                        selectedModel.defaultEffort ?? "none",
                      ),
                    )}
                    onSelect={(_i, opt) => {
                      const v = opt?.value;
                      if (typeof v === "string")
                        updateModel(selectedModel.id, {
                          defaultEffort: v as never,
                        });
                    }}
                  />
                </box>
                <box flexDirection="column">
                  <box flexDirection="row" gap={1} border borderColor={theme.border} paddingX={1} title="Model Cost" titleColor={theme.textMuted} focusable focusedBorderColor={theme.borderActive}>
                    <InputField
                      title="Input"
                      value={
                        selectedModel.billing?.input != null
                          ? String(selectedModel.billing.input)
                          : ""
                      }
                      placeholder="0"
                      onChange={(v) => {
                        const n = v ? parseFloat(v) : undefined;
                        updateModel(selectedModel.id, {
                          billing: { ...selectedModel.billing, input: n },
                        });
                      }}
                    />
                    <InputField
                      title="Output"
                      value={
                        selectedModel.billing?.output != null
                          ? String(selectedModel.billing.output)
                          : ""
                      }
                      placeholder="0"
                      onChange={(v) => {
                        const n = v ? parseFloat(v) : undefined;
                        updateModel(selectedModel.id, {
                          billing: { ...selectedModel.billing, output: n },
                        });
                      }}
                    />
                    <InputField
                      title="Cache Read"
                      value={
                        selectedModel.billing?.cacheRead != null
                          ? String(selectedModel.billing.cacheRead)
                          : ""
                      }
                      placeholder="0"
                      onChange={(v) => {
                        const n = v ? parseFloat(v) : undefined;
                        updateModel(selectedModel.id, {
                          billing: { ...selectedModel.billing, cacheRead: n },
                        });
                      }}
                    />
                    <InputField
                      title="Cache Write"
                      value={
                        selectedModel.billing?.cacheWrite != null
                          ? String(selectedModel.billing.cacheWrite)
                          : ""
                      }
                      placeholder="0"
                      onChange={(v) => {
                        const n = v ? parseFloat(v) : undefined;
                        updateModel(selectedModel.id, {
                          billing: {
                            ...selectedModel.billing,
                            cacheWrite: n,
                          },
                        });
                      }}
                    />
                    <InputField
                      title="Cost Multiplier"
                      value={
                        selectedModel.billing?.multiplier != null
                          ? String(selectedModel.billing.multiplier)
                          : ""
                      }
                      placeholder="1"
                      onChange={(v) => {
                        const n = v ? parseFloat(v) : undefined;
                        updateModel(selectedModel.id, {
                          billing: {
                            ...selectedModel.billing,
                            multiplier: n,
                          },
                        });
                      }}
                    />
                    <InputField
                      title="Batch Size"
                      value={
                        selectedModel.billing?.batchSize != null
                          ? String(selectedModel.billing.batchSize)
                          : ""
                      }
                      placeholder="1"
                      onChange={(v) => {
                        const n = v ? parseInt(v, 10) : undefined;
                        updateModel(selectedModel.id, {
                          billing: { ...selectedModel.billing, batchSize: n },
                        });
                      }}
                    />
                  </box>
                </box>
              </box>
            )}
          </box>
        )}
        <box flexDirection="row" gap={1} justifyContent="flex-end">
          <Button onPress={addModel}>Add Model</Button>
          {selectedModel && (
            <Button
              variant="error"
              onPress={() => removeModel(selectedModel.id)}
            >
              Remove model
            </Button>
          )}
        </box>
      </box>
    </scrollbox>
  );
};
