import { useTheme } from "../../hooks/useTheme";
import { logo } from "../symbols/logo";

const HELP_MARKDOWN = `- **return** — Submit the prompt; the agent reads, plans and edits your project.
**tab / shift+tab** — Cycle agents (ask · plan · coder) and thinking depth.
**ctrl+m** — Open the model picker.
**ctrl+t** — Pick a file from a tree and link it into the prompt as an \`@path\` token.
**ctrl+v** — Paste an image from the clipboard into the prompt.
**ctrl+q** — Queue the next prompt — it runs after the current run finishes.
**ctrl+w** — Steer the run — the next prompt stops the current run and takes over.
**esc esc** — Interrupt the running agent.
**esc** — Close the current dialog or picker.
**ctrl+?** — Open this help dialog; typing ? as the prompt's first character works too.
**ctrl+c** — Exit picobu.`;

export const HelpDialog = () => {
  const { syntax } = useTheme();
  return (
    <box flexDirection="column" paddingY={1} gap={1}>
      <text>{logo()}</text>
      <markdown
        flexGrow={1}
        flexShrink={1}
        syntaxStyle={syntax}
        conceal
        content={HELP_MARKDOWN}
      />
    </box>
  );
};