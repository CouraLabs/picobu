import { useCallback, useRef, type RefObject } from "react";
import { useKeyboard } from "@opentui/react";
import type { TextareaRenderable } from "@opentui/core";
import { loopStore } from "../stores/loop-store";
import { addPrompt, loadPromptHistory, PROMPT_HISTORY_LIMIT } from "../libs/prompt-history";

/**
 * Prompt history for the prompt textarea: the last 10 submitted prompts,
 * persisted to `<systemDir>/prompt-history.json` so they survive app restarts.
 *
 * Arrow-up cycles backwards through the stack when the cursor sits at offset 0;
 * arrow-down cycles forward when the cursor is at/after the last character, and
 * past the newest entry it restores the in-progress draft. Editing a recalled
 * prompt moves it to the last slot of the stack.
 */
export const usePromptHistory = (textareaRef: RefObject<TextareaRenderable | null>) => {
  const history = useRef<string[] | null>(null);
  if (history.current === null) history.current = loadPromptHistory();
  const recallIndex = useRef<number | null>(null);
  const draft = useRef("");
  // Guard around programmatic setText during recall so the content-change
  // callback does not mistake it for a user edit (mirrors usePromptClipboard).
  const applying = useRef(false);

  const setPromptText = useCallback(
    (text: string, cursorAtStart: boolean) => {
      const ta = textareaRef.current;
      if (!ta) return;
      applying.current = true;
      try {
        ta.setText(text);
        if (cursorAtStart) {
          ta.setCursor(0, 0);
        } else {
          const lines = text.split("\n");
          ta.setCursor(lines.length - 1, lines[lines.length - 1]?.length ?? 0);
        }
      } finally {
        applying.current = false;
      }
    },
    [textareaRef],
  );

  useKeyboard((key) => {
    if (key.name !== "up" && key.name !== "down") return;
    const ta = textareaRef.current;
    if (!ta || !ta.focused) return;
    // The pickers own up/down for their own navigation.
    const ui = loopStore.getSnapshot().context;
    if (ui.commandOpen || ui.modelPickerOpen || ui.effortOpen) return;

    const hist = history.current ?? [];
    const offset = ta.editorView.getVisualCursor().offset;

    if (key.name === "up") {
      // Cycle back only when the cursor sits at the very start.
      if (offset !== 0 || hist.length === 0) return;
      if (recallIndex.current === null) {
        draft.current = ta.plainText;
        recallIndex.current = hist.length - 1;
      } else if (recallIndex.current > 0) {
        recallIndex.current -= 1;
      } else {
        return; // already at the oldest prompt
      }
      key.preventDefault();
      key.stopPropagation();
      setPromptText(hist[recallIndex.current] ?? "", true);
      return;
    }

    // Arrow down: only cycle when the cursor is at/after the last character.
    if (recallIndex.current === null || offset < ta.plainText.length) return;
    key.preventDefault();
    key.stopPropagation();
    if (recallIndex.current < hist.length - 1) {
      recallIndex.current += 1;
      setPromptText(hist[recallIndex.current] ?? "", false);
    } else {
      recallIndex.current = null;
      setPromptText(draft.current, false);
    }
  });

  /** Textarea content changed: an edit to a recalled prompt detaches it from
   * its old slot and moves the edited text to the last stack slot. */
  const notifyEdit = useCallback(() => {
    if (applying.current) return;
    const index = recallIndex.current;
    if (index === null) return;
    recallIndex.current = null;
    const ta = textareaRef.current;
    const hist = history.current;
    if (!ta || !hist) return;
    const removed = hist.splice(index, 1)[0];
    const current = ta.plainText;
    if (removed !== undefined && current !== removed && current.trim() && !current.startsWith("/")) {
      hist.push(current);
      while (hist.length > PROMPT_HISTORY_LIMIT) hist.shift();
    }
    draft.current = current;
  }, [textareaRef]);

  /** Record a submitted prompt as the newest entry and persist it. */
  const commitPrompt = useCallback((text: string) => {
    const hist = history.current;
    if (hist && text.trim()) history.current = addPrompt(text, hist);
    recallIndex.current = null;
    draft.current = "";
  }, []);

  return { notifyEdit, commitPrompt };
};
