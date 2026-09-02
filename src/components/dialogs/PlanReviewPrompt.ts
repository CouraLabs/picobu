import type { PlanComment } from "../../stores/interaction-store";

const commentLines = (comments: PlanComment[]): string[] =>
  comments.map((c) => `- L${c.line}${c.text ? ` · "${c.text}"` : ""}: ${c.comment}`);

/**
 * Revision prompt sent when the user is not satisfied with the plan. The plan
 * agent is still active: it must revise the plan addressing every comment and
 * resubmit via `plan-write` (never `plan-exit`).
 */
export const buildRevisionPrompt = (comments: PlanComment[]): string => {
  const head = [
    "[Plan not approved — revise]",
    "The user reviewed the plan and is not satisfied. Revise it, addressing every line comment below,",
    "and submit the updated plan again with plan-write (do not call plan-exit).",
  ];
  if (!comments.length) return head.join("\n");
  return [...head, "", "Line comments:", ...commentLines(comments)].join("\n");
};

/**
 * Approval prompt sent when the user confirms the plan (with or without
 * comments). The plan agent must call `plan-exit` to hand off to the Coder
 * agent, then implementation proceeds.
 */
export const buildApprovePrompt = (comments: PlanComment[]): string => {
  const head = [
    "[Plan approved — start implementation]",
    "The user accepted the plan. Call plan-exit to hand off to the Coder agent, then implement the plan.",
  ];
  if (!comments.length) return head.join("\n");
  return [...head, "", "Line comments to address during implementation:", ...commentLines(comments)].join("\n");
};