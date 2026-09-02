import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "@xstate/store-react";
import { TextAttributes, type InputRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { Button } from "../ui/Button";
import { interactionStore, type PlanComment } from "../../stores/interaction-store";
import { themeStore } from "../../stores/theme-store";
import { useSessionBindings } from "../../providers/SessionBindings";
import { useDialog } from "../../hooks/useDialog";
import { usePlanComments } from "./use-plan-comments";
import type { PromptFile } from "../../libs/embeds";
import { buildApprovePrompt, buildRevisionPrompt } from "./plan-review-prompt";

export type PlanReviewDialogProps = {
  plan: string;
  partKey: string;
};

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * Line-by-line plan review. Clicking a markdown line opens an inline comment
 * editor (clipped line info + an input field). Comments are persisted to the
 * interaction store so the footer buttons and the tool-call summary stay in
 * sync; X/ESC closes (dismissed) without sending anything.
 */
export const PlanReviewDialog = ({ plan, partKey }: PlanReviewDialogProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const dims = useTerminalDimensions();
  const { sessionId } = useSessionBindings();
  const comments = usePlanComments(sessionId, partKey);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const inputRef = useRef<InputRenderable | null>(null);

  const lines = useMemo(() => plan.split("\n"), [plan]);
  const gutter = String(lines.length).length;
  const avail = Math.max(16, Math.floor(dims.width * 0.66) - 2 - gutter);

  // Closing via X/ESC leaves no explicit decision: record it as dismissed so
  // the dialog never reopens on later renders. Approve/reject are recorded by
  // the footer before closing, so their cleanup is a no-op.
  useEffect(
    () => () => {
      const status = interactionStore.getSnapshot().context.planWriteStatus[sessionId]?.[partKey];
      if (!status || status === "open") {
        interactionStore.trigger.markPlanWriteStatus({ sessionId, partKey, status: "dismissed" });
      }
    },
    [sessionId, partKey],
  );

  const persist = (next: PlanComment[]) =>
    interactionStore.trigger.setPlanWriteComments({ sessionId, partKey, comments: next });

  const selectLine = (idx: number) => {
    setActiveLine(idx);
    const existing = comments.find((c) => c.line === idx + 1);
    setDraft(existing?.comment ?? "");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const saveComment = () => {
    if (activeLine === null) return;
    const text = draft.trim();
    if (!text) {
      removeComment();
      return;
    }
    const next = comments.filter((c) => c.line !== activeLine + 1);
    next.push({ line: activeLine + 1, text: clip(lines[activeLine] ?? "", avail), comment: text });
    next.sort((a, b) => a.line - b.line);
    persist(next);
    setActiveLine(null);
    setDraft("");
  };

  const removeComment = () => {
    if (activeLine === null) return;
    persist(comments.filter((c) => c.line !== activeLine + 1));
    setActiveLine(null);
    setDraft("");
  };

  return (
    <box flexDirection="column" gap={1}>
      <text selectable={false} fg={theme.textMuted}>
        {`Click a line to add a comment.${comments.length ? ` ${comments.length} comment(s) added.` : ""} Confirm to approve the plan; "Not satisfied" asks the agent to revise it.`}
      </text>
      <box flexDirection="column" gap={0}>
        {lines.map((line, i) => {
          const commented = comments.some((c) => c.line === i + 1);
          const active = activeLine === i;
          return (
            <Fragment key={i}>
              <box
                flexDirection="row"
                gap={1}
                width="100%"
                backgroundColor={active ? theme.accent : hoverLine === i ? theme.backgroundElement : "transparent"}
                onMouseDown={() => selectLine(i)}
                onMouseOver={() => setHoverLine(i)}
                onMouseOut={() => setHoverLine(null)}
              >
                <text selectable={false} fg={active ? theme.background : theme.textMuted}>
                  {String(i + 1).padStart(gutter, " ")}
                </text>
                <text selectable={false} fg={commented ? theme.warning : active ? theme.background : theme.text}>
                  {clip(line, avail)}
                </text>
                {commented && (
                  <text selectable={false} fg={theme.warning}>
                    {"✎"}
                  </text>
                )}
              </box>
              {active && (
                <box
                  flexDirection="column"
                  gap={1}
                  paddingX={2}
                  paddingY={1}
                  borderStyle="single"
                  border={["left"]}
                  borderColor={theme.accent}
                >
                  <text selectable={false} fg={theme.accent} attributes={TextAttributes.BOLD}>
                    {`L${i + 1} · ${clip(line, avail)}`}
                  </text>
                  <input
                    ref={inputRef}
                    value={draft}
                    maxLength={2000}
                    placeholder="Add a comment for this line…"
                    textColor={theme.text}
                    placeholderColor={theme.textMuted}
                    backgroundColor="transparent"
                    focusedBackgroundColor={theme.backgroundElement}
                    onInput={(v) => setDraft(String(v))}
                  />
                  <box flexDirection="row" gap={1}>
                    <Button variant="info" onPress={saveComment}>
                      Save comment
                    </Button>
                    {commented && (
                      <Button variant="error" bordered={false} onPress={removeComment}>
                        Remove
                      </Button>
                    )}
                    <Button
                      variant="default"
                      bordered={false}
                      onPress={() => {
                        setActiveLine(null);
                        setDraft("");
                      }}
                    >
                      Cancel
                    </Button>
                  </box>
                </box>
              )}
            </Fragment>
          );
        })}
      </box>
    </box>
  );
};

/** Dialog footer: the two plan-review decisions. `onPrompt` is threaded in from
 *  the tool-call renderer because the dialog renders outside the session
 *  provider tree (it can't use `useSession`). */
export const PlanReviewFooter = ({ partKey, onPrompt }: { partKey: string; onPrompt: (text?: string, files?: PromptFile[]) => void }) => {
  const { sessionId } = useSessionBindings();
  const dialog = useDialog();
  const comments = usePlanComments(sessionId, partKey);

  const reject = () => {
    interactionStore.trigger.markPlanWriteStatus({ sessionId, partKey, status: "rejected" });
    dialog.close();
    // Always send the revision prompt — `buildRevisionPrompt([])` handles the
    // no-comments case. Without this the plan agent is left paused forever.
    onPrompt(buildRevisionPrompt(comments));
  };

  const approve = () => {
    interactionStore.trigger.markPlanWriteStatus({ sessionId, partKey, status: "approved" });
    dialog.close();
    onPrompt(buildApprovePrompt(comments));
  };

  return (
    <box flexDirection="row" gap={1}>
      <Button variant="error" onPress={reject}>
        Not satisfied
      </Button>
      <Button variant="success" onPress={approve}>
        {comments.length ? `Confirm with comments (${comments.length})` : "Confirm plan"}
      </Button>
    </box>
  );
};