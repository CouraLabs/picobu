import { useEffect, useRef } from "react";
import { useSelector } from "@xstate/store-react";
import type { SelectRenderable } from "@opentui/core";
import { themeStore } from "../../../stores/theme-store";
import { loopStore, THINKING_LEVELS } from "../../../stores/loop-store";
import type { ProviderModelReasoningEffort } from "../../../libs/options";

/** One-line guidance for each reasoning-effort level, shown under its name. */
const EFFORT_DESCRIPTIONS: Record<string, string> = {
  none: "No reasoning. Fastest response, lowest cost; best for trivial or mechanical tasks.",
  low: "Minimal reasoning. Quick answers for simple tasks with a light quality tradeoff.",
  medium: "Balanced reasoning and cost. A solid default for everyday coding work.",
  high: "Strong reasoning for complex, multi-step tasks; trades time and tokens for quality.",
  xhigh: "Deep reasoning for hard problems; noticeably slower and costlier but far more careful.",
  max: "Maximum reasoning, exhaustive analysis for the hardest problems; slowest and most expensive.",
};

/**
 * Effort (thinking-level) picker, opened by `/effort` (no argument). Mirrors
 * ModelPicker: a focus-trapping `select` of THINKING_LEVELS that sets the
 * active thinking effort on selection.
 */
export const EffortPicker = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const effortOpen = useSelector(loopStore, (s) => s.context.effortOpen);
  const thinking = useSelector(loopStore, (s) => s.context.thinking);
  const selectRef = useRef<SelectRenderable>(null);

  const options = THINKING_LEVELS.map((level) => ({
    name: level,
    description: EFFORT_DESCRIPTIONS[level] ?? "",
    value: level,
  }));
  const selectedIndex = Math.max(0, THINKING_LEVELS.indexOf(thinking));

  useEffect(() => {
    if (!effortOpen) return;
    const id = setTimeout(() => selectRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [effortOpen]);

  if (!effortOpen) return null;

  return (
    <box border borderStyle="single" title=" Effort " titleColor={theme.text} borderColor={theme.border}>
      <select
        ref={selectRef}
        height={Math.min(THINKING_LEVELS.length, 5) * 2}
        showScrollIndicator
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
            loopStore.trigger.setThinking({
              thinking: option.value as ProviderModelReasoningEffort,
            });
          }
          loopStore.trigger.closeEffort();
        }}
      />
    </box>
  );
};