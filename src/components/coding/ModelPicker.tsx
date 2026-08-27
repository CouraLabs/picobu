import { useEffect, useRef } from "react";
import { useSelector } from "@xstate/store-react";
import type { SelectRenderable } from "@opentui/core";
import { loopStore } from "../../stores/loop-store";
import { themeStore } from "../../stores/theme-store";
import { listModels, type ModelEntry } from "../../harness/agent/factory/provider-resolver";
import type { ProviderModelBilling } from "../../libs/options";

const MODELS = listModels();

/** Format a token count as a compact human label (e.g. 1_000_000 -> "1M"). */
const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}K`;
  }
  return String(n);
};

/** Format a per-1M-token dollar figure as "$0.40" (trailing zeros trimmed for whole dollars). */
const fmtCost = (n?: number): string => {
  if (n === undefined) return "";
  const fixed = n.toFixed(2);
  return `$${fixed.replace(/\.00$/, "")}`;
};

const costLabel = (billing?: ProviderModelBilling): string => {
  if (!billing) return "";
  if (
    billing.input === undefined &&
    billing.output === undefined &&
    billing.cacheRead === undefined &&
    billing.cacheWrite === undefined
  ) {
    return "";
  }
  const input = billing.input !== undefined ? fmtCost(billing.input) : "?";
  const output = billing.output !== undefined ? fmtCost(billing.output) : "?";
  const parts = [`${input}/${output} per M`];
  // A cache price of 0 (or unset) means caching is free/off — only show a real price.
  if (billing.cacheRead) parts.push(`read ${fmtCost(billing.cacheRead)}`);
  if (billing.cacheWrite) parts.push(`write ${fmtCost(billing.cacheWrite)}`);
  return parts.join(" · ");
};

const describe = (m: ModelEntry): string => {
  const parts: string[] = [];
  const caps = m.supports.length ? m.supports.join(", ") : "";
  if (caps) parts.push(caps);
  parts.push(`${fmtTokens(m.context)} ctx`);
  const cost = costLabel(m.billing);
  if (cost) parts.push(cost);
  return parts.join(" · ");
};

export const ModelPicker = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const modelKey = useSelector(loopStore, (s) => s.context.modelKey);
  const selectRef = useRef<SelectRenderable>(null);

  const options = MODELS.map((m) => ({
    name: `${m.providerName} ${m.modelName}`,
    description: describe(m),
    value: m.key,
  }));
  const selectedIndex = Math.max(0, MODELS.findIndex((m) => m.key === modelKey));

  useEffect(() => {
    const id = setTimeout(() => selectRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);

  return (
    <box border borderStyle="single" title=" Models " titleColor={theme.text} borderColor={theme.border}>
      <select
        ref={selectRef}
        height={MODELS.length * 2}
        options={options}
        selectedIndex={selectedIndex}
        textColor={theme.text}
        focusedTextColor={theme.text}
        selectedTextColor={theme.selectedListItemText}
        descriptionColor={theme.textMuted}
        selectedDescriptionColor={theme.textMuted}
        backgroundColor="transparent"
        focusedBackgroundColor="transparent"
        selectedBackgroundColor="transparent"
        onSelect={(_index, option) => {
          if (option && typeof option.value === "string") {
            loopStore.trigger.setModel({ modelKey: option.value });
          }
          loopStore.trigger.closeModelPicker();
        }}
      />
    </box>
  );
};