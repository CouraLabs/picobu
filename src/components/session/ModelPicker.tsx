import { useEffect, useRef } from "react";
import { useSelector } from "@xstate/store-react";
import type { SelectRenderable } from "@opentui/core";
import { loopStore } from "../../stores/loop-store";
import { themeStore } from "../../stores/theme-store";
import { listModels, type ModelEntry } from "../../harness/agent/factory/provider-resolver";
import type { ProviderModelBilling } from "../../libs/options";

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

const PRICE_KEYS = ["cacheRead", "output", "input"] as const;

/** Order models cheapest-first: cache read, then output, then input, then name.
 *  Models missing a given price (or billing entirely) sort to the end.
 *  When no cache-read price is set, a cache-write price is used as the cache price. */
export const sortByPrice = (a: ModelEntry, b: ModelEntry): number => {
  const price = (m: ModelEntry, key: (typeof PRICE_KEYS)[number]): number => {
    if (key === "cacheRead") {
      const cr = m.billing?.cacheRead;
      const cw = m.billing?.cacheWrite;
      // Prefer an explicit read price; fall back to the write price when read is unset.
      return (cr ?? cw) ?? Infinity;
    }
    return m.billing?.[key] ?? Infinity;
  };
  for (const key of PRICE_KEYS) {
    const diff = price(a, key) - price(b, key);
    if (diff !== 0) return diff;
  }
  return a.modelName.localeCompare(b.modelName);
};

export const describe = (m: ModelEntry): string => {
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

  // Fresh each render: the options singleton is hydrated after settings saves,
  // so a module-level snapshot would keep listing removed/renamed models.
  const models = listModels().slice().sort(sortByPrice);

  const options = models.map((m) => ({
    name: `${m.providerName} ${m.modelName}`,
    description: describe(m),
    value: m.key,
  }));
  const selectedIndex = Math.max(0, models.findIndex((m) => m.key === modelKey));

  useEffect(() => {
    const id = setTimeout(() => selectRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);

  return (
    <box border borderStyle="single" title=" Models " titleColor={theme.text} borderColor={theme.border}>
      <select
        ref={selectRef}
        height={Math.min(models.length, 5) * 2}
        showScrollIndicator
        options={options}
        selectedIndex={selectedIndex}
        textColor={theme.text}
        focusedTextColor={theme.text}
        selectedTextColor={theme.accent}
        descriptionColor={theme.textMuted}
        selectedDescriptionColor={theme.accent}
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