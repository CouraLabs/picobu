import { useEffect, useRef } from "react";
import { useSelector } from "@xstate/store-react";
import { interactionStore } from "../../../stores/interaction-store";
import { themeStore } from "../../../stores/theme-store";
import { ToolCallShell } from "./ToolCallShell";
import { usePlanComments } from "../../../hooks/usePlanComments";
import { useSession } from "../../../hooks/useSession";
import { useSessionBindings } from "../../../providers/SessionBindings";
import { useDialog } from "../../../hooks/useDialog";
import { PlanReviewDialog, PlanReviewFooter } from "../../dialogs/PlanReviewDialog";
import type { ToolStatus } from "../ToolCall";

export type PlanWriteToolCallProps = {
  status: ToolStatus;
  error?: string;
  plan: string;
  partKey: string;
  isPending: boolean;
  hasFollowingUserMessage: boolean;
};

/**
 * Plan submission tool call. When this part is the pending (last) plan-write
 * and the run has settled, it auto-opens the review dialog once. The dialog is
 * keyed through the interaction store (`planWriteStatus`), so it never reopens
 * after approve/reject/dismiss even when the message list re-renders.
 */
export const PlanWriteToolCall = ({ plan, status, error, partKey, isPending, hasFollowingUserMessage, copyText }: PlanWriteToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const { sessionId } = useSessionBindings();
  const { streaming, onPrompt } = useSession();
  const dialog = useDialog();
  const writeStatus = useSelector(interactionStore, (s) => s.context.planWriteStatus[sessionId]?.[partKey]);
  const comments = usePlanComments(sessionId, partKey);
  const openedRef = useRef(false);

  useEffect(() => {
    if (streaming || openedRef.current || writeStatus || !isPending || hasFollowingUserMessage) return;
    if (!plan) return;
    openedRef.current = true;
    interactionStore.trigger.markPlanWriteOpen({ sessionId, partKey });
    dialog.replace(
      <PlanReviewDialog plan={plan} partKey={partKey} />,
      "large",
      "Plan Review",
      <PlanReviewFooter partKey={partKey} onPrompt={onPrompt} />,
    );
    dialog.open();
  }, [streaming, isPending, hasFollowingUserMessage, writeStatus, plan, partKey, sessionId, dialog, onPrompt]);

  const lineCount = plan ? plan.split("\n").length : 0;

  return (
    <ToolCallShell
      name="Plan Write"
      status={status}
      error={error}
      copyText={copyText}
      defaultCollapsed={false}
      collapsible={false}
      copyable={false}
      header={(hovered) => (
        <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>
          {`${lineCount} lines · ${comments.length} comment(s)`}
        </text>
      )}
    >
      <text selectable={false} fg={theme.textMuted}>
        {writeStatus
          ? `Plan review ${writeStatus}.`
          : "Plan submitted for review — open the dialog to comment line by line."}
      </text>
    </ToolCallShell>
  );
};