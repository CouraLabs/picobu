import { useState } from "react";
import { useTheme } from "../../hooks/useTheme";
import { pickMotivationalPhrase } from "./MotivationalPhrases";

/** Spinner + a random life-motivational phrase shown while the model is
 * executing. Mounted only while a run streams, so the phrase is re-picked
 * once per execution (the initializer runs on every mount). */
export const ThinkingIndicator = () => {
  const { theme } = useTheme();
  const [phrase] = useState(() => pickMotivationalPhrase());
  return (
    <box flexDirection="row" gap={1}>
      <spinner name="sand" color={theme.accent} />
      <text fg={theme.textMuted}>{phrase}</text>
    </box>
  );
};
