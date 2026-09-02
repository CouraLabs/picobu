import { useEffect, useRef } from "react";
import { useSelector } from "@xstate/store-react";
import type { MouseEvent, TextareaRenderable } from "@opentui/core";
import { useTheme } from "../../hooks/useTheme";
import { useDialog } from "../../hooks/useDialog";
import { loopStore } from "../../stores/loop-store";
import { icons } from "../symbols/icons";
import { filterCommands, commandModeFor } from "../../harness/commands";
import { useSessionBindings } from "../../providers/SessionBindings";
import { HelpDialog } from "../HelpDialog";

import { usePromptClipboard } from "../../hooks/usePromptClipboard";
import { usePromptHistory } from "../../hooks/usePromptHistory";
import type { PromptFile } from "../../libs/embeds";

export type PromptProps = {
  onSubmit: (text: string, files: PromptFile[]) => void;
  /** Which session tab the prompt serves; gates command availability flags. */
  kind: "coding" | "persistent";
};

export const Prompt = ({ onSubmit, kind }: PromptProps) => {
  const { bindCommandAccept, bindInsertPrompt, frontend } = useSessionBindings();
  const dialog = useDialog();
  const { theme } = useTheme();
  const modelPickerOpen = useSelector(loopStore, (s) => s.context.modelPickerOpen);
  const commandOpen = useSelector(loopStore, (s) => s.context.commandOpen);
  const effortOpen = useSelector(loopStore, (s) => s.context.effortOpen);
  const sessionsOpen = useSelector(loopStore, (s) => s.context.sessionsOpen);
  const contactsOpen = useSelector(loopStore, (s) => s.context.contactsOpen);
  const rolePickerOpen = useSelector(loopStore, (s) => s.context.rolePickerOpen);
  const queueMode = useSelector(loopStore, (s) => s.context.queueMode);
  const steeringMode = useSelector(loopStore, (s) => s.context.steeringMode);
  const textareaRef = useRef<TextareaRenderable>(null);
  const { embedSyntax, handleContentChange, resolveAndClear } = usePromptClipboard(textareaRef);
  // Persistent prompt history (last 10, stored in <systemDir>/prompt-history.json).
  const { notifyEdit, commitPrompt } = usePromptHistory(textareaRef);

  // Focus the input on mount, and return focus to it whenever a picker closes
  // (open-tui needs a tick before the textarea accepts focus). While a picker
  // is open it owns the keyboard, so the textarea never steals focus back.
  useEffect(() => {
    if (modelPickerOpen || effortOpen || sessionsOpen || contactsOpen || rolePickerOpen) return;
    const id = setTimeout(() => textareaRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [modelPickerOpen, effortOpen, sessionsOpen, contactsOpen, rolePickerOpen]);

  // Live slash-command filtering: opening `/` starts command mode, while a
  // space (args) or a deleted `/` closes it and reverts to a normal prompt.
  // Tab-accept writes the chosen name back into the textarea. Commands are
  // filtered by the session mode (code/persistent + web) availability flags.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const mode = commandModeFor(kind, frontend === "web");
    ta.onContentChange = () => {
      handleContentChange();
      // An edit to a recalled history entry moves it to the last stack slot.
      notifyEdit();
      const t = textareaRef.current?.plainText ?? "";
      // Help shortcut: `?` typed as the prompt's first character opens the
      // help dialog instead of being sent (mirrors the ctrl+? global binding).
      if (t === "?") {
        ta.clear();
        loopStore.trigger.closeCommand();
        dialog.replace(<HelpDialog />, "medium", "Keyboard Shortcuts");
        dialog.open();
        return;
      }
      const inCommand = t.startsWith("/") && !t.slice(1).includes(" ");
      if (inCommand) {
        if (filterCommands(t.slice(1), mode).length) {
          loopStore.trigger.openCommand({ query: t.slice(1) });
        } else {
          loopStore.trigger.closeCommand();
        }
      } else {
        loopStore.trigger.closeCommand();
      }
    };
    bindCommandAccept((name) => {
      const target = textareaRef.current;
      if (target) {
        target.setText("/" + name + " ");
        target.focus();
      }
      loopStore.trigger.closeCommand();
    });
    // Pickers that stage a command into the prompt (contacts picker) overwrite
    // the textarea content and hand focus back.
    bindInsertPrompt((text) => {
      const target = textareaRef.current;
      if (target) {
        target.setText(text);
        target.focus();
      }
      loopStore.trigger.closeCommand();
      loopStore.trigger.closeContactsPicker();
    });
    // `dialog`/bindings functions are stable context values; `kind`/`frontend`
    // select the command mode, so the bindings must re-register if they change.
  }, [handleContentChange, notifyEdit, kind, frontend, dialog, bindCommandAccept, bindInsertPrompt]);

  const submit = () => {
    if (textareaRef.current?.plainText.trim() === "/") return; // bare slash: just the picker
    const resolved = resolveAndClear();
    commitPrompt(resolved.text);
    onSubmit(resolved.text, resolved.files);
    textareaRef.current?.clear();
  };

  // Click-to-position: map a click on the prompt box into the textarea's buffer
  // offset (logical line via `lineSources`, display column via the wrap spans),
  // then move the cursor. The textarea's own `onMouseDown` never fires — the
  // renderer swallows `down` on selectable renderables to start a selection —
  // so the handler lives on the surrounding box.
  const handleMouseDown = (e: MouseEvent) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();

    const info = ta.editorView.getLineInfo();
    const lineSources = info.lineSources;
    const lineStartCols = info.lineStartCols;
    const lineWidthCols = info.lineWidthCols;
    if (!lineSources.length) return;

    // Widget-relative cell of the click. Mouse events report terminal-absolute
    // coordinates, so subtract the textarea's own screen origin.
    const localX = e.x - ta.screenX;
    const localY = e.y - ta.screenY;
    const visualRow = localY + ta.scrollY;
    const col = Math.max(0, localX);

    // Line k represents source line `lineSources[k]`, starting at display
    // column `lineStartCols[k]`. Pick the visual line under the cursor.
    let sourceRow = 0;
    let baseCol = 0;
    let maxCol = 0;
    let found = false;
    for (let k = 0; k < lineSources.length; k++) {
      const start = lineStartCols[k] ?? 0;
      const width = lineWidthCols[k] ?? 0;
      if (visualRow === k) {
        sourceRow = lineSources[k] ?? 0;
        baseCol = start;
        maxCol = start + width;
        found = true;
        break;
      }
    }
    if (!found) {
      // Click beyond the last visual line: place at the end of the last source line.
      const last = lineSources.length - 1;
      sourceRow = lineSources[last] ?? 0;
      baseCol = lineStartCols[last] ?? 0;
      maxCol = (lineStartCols[last] ?? 0) + (lineWidthCols[last] ?? 0);
    }

    const targetCol = Math.min(Math.max(col, baseCol), Math.max(baseCol, maxCol - 1));
    ta.setCursor(sourceRow, targetCol);
  };

  return (
    <box
      flexDirection="row"
      gap={1}
      border={['top', 'bottom']}
      borderStyle={queueMode ? "double" : steeringMode ? "heavy" : "single"}
      borderColor={queueMode ? theme.info : steeringMode ? theme.error : commandOpen ? theme.accent : theme.border}
      titleColor={queueMode ? theme.info : steeringMode ? theme.error : commandOpen ? theme.accent : theme.textMuted}
      title={queueMode ? " Prompt - Queue " : steeringMode ? " Prompt Steering " : commandOpen ? " Command " : " Prompt "}
      titleAlignment="right"
      onMouseDown={() => textareaRef.current?.focus()}
    >
      <text fg={queueMode ? theme.info : steeringMode ? theme.error : commandOpen ? theme.accent : theme.textMuted}> {icons.prompt}</text>
      <box flexGrow={1} onMouseDown={handleMouseDown}>
        <textarea
          ref={textareaRef}
          id="prompt"
          maxHeight={10}
          placeholder="What are we going to build?"
          placeholderColor={theme.textMuted}
          cursorColor={theme.accent}
          textColor={theme.text}
          syntaxStyle={embedSyntax}
          onSubmit={submit}
          keyBindings={[
            { name: "return", action: "submit" },
            { name: "return", shift: true, action: "newline" },
          ]}
        />
      </box>
    </box>
  );
};