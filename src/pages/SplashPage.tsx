import { useSelector } from "@xstate/store-react";
import { themeStore } from "../stores/theme-store";
import { logo } from "../components/symbols/logo";

const OVERVIEW = `# PICOBU

An autonomous coding agent that runs inside your terminal.

- Press **return** to start a run; the agent reads, plans and edits your project, step by step.
- **tab** / **shift+tab** switch between the Ask, Plan and Coder agents and cycle thinking depth.
- **ctrl+m** opens the model picker.
- Switch to home any time — an in-flight run keeps going in the background.
- **ctrl+c** exits.

Everything lives in \`~/.picobu/options.json\` — providers, models and billing.`;

export const SplashPage = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const syntax = useSelector(themeStore, (s) => s.context.syntax);
  return (
    <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1} gap={2}>
      <box justifyContent="center" alignItems="flex-end">
        <box flexDirection="column">
          <text>{logo()}</text>
        </box>
      </box>
      <box width={70} flexDirection="column">
        <markdown content={OVERVIEW} syntaxStyle={syntax} fg={theme.text} />
      </box>
    </box>
  );
};