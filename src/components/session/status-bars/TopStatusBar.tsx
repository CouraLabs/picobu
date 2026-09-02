import { basename } from "node:path";
import { useSelector } from "@xstate/store-react";
import { TextAttributes } from "@opentui/core";
import { themeStore } from "../../../stores/theme-store";
import { loopStore } from "../../../stores/loop-store";
import { icons } from "../../symbols/icons";
import { useGitStatus } from "../../../hooks/useGitStatus";

/**
 * Status bar under the prompt: provider/model, thinking level, context usage,
 * ttft, token throughput, the running session timer, and a project line with
 * the current folder, git branch and working-tree add/delete counts.
 */
export const TopStatusBar = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const cwd = useSelector(loopStore, (s) => s.context.cwd);
  const { branch, additions, deletions, isRepo } = useGitStatus();
  const folder = `/${basename(cwd)}`;
  const repoText = isRepo ? `${icons.git} ${branch}` : "no git repo";

  return (
    <box flexDirection="row" gap={1}>
      <text selectable={false} fg={theme.accent}>{folder}</text>
      <text selectable={false} fg={theme.textMuted} attributes={TextAttributes.DIM}>·</text>
      <text selectable={false} fg={theme.secondary}>{repoText}</text>
      <text selectable={false} fg={theme.textMuted} attributes={TextAttributes.DIM}>·</text>
      <text selectable={false} fg={theme.success}>+{additions}</text>
      <text selectable={false} fg={theme.error}>-{deletions}</text>
    </box>
  );
};