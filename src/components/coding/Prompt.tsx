import { useEffect, useRef } from "react";
import { useSelector } from "@xstate/store-react";
import type { TextareaRenderable } from "@opentui/core";
import { themeStore } from "../../stores/theme-store";
import { loopStore } from "../../stores/loop-store";
import { icons } from "../symbols/icons";
import { bindCommandAccept, filterCommands } from "../../harness/commands";
import { usePromptClipboard } from "../../hooks/usePromptClipboard";
import type { PromptFile } from "../../libs/embeds";

export type PromptProps = {
  onSubmit: (text: string, files: PromptFile[]) => void;
};

export const Prompt = ({ onSubmit }: PromptProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const modelPickerOpen = useSelector(loopStore, (s) => s.context.modelPickerOpen);
  const commandOpen = useSelector(loopStore, (s) => s.context.commandOpen);
  const textareaRef = useRef<TextareaRenderable>(null);
  const { embedSyntax, handleContentChange, resolveAndClear } = usePromptClipboard(textareaRef);

  // Focus the input on mount, and return focus to it once the model picker
  // closes (open-tui needs a tick before the textarea accepts focus).
  useEffect(() => {
    if (modelPickerOpen) return;
    const id = setTimeout(() => textareaRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [modelPickerOpen]);

  // Live slash-command filtering: opening `/` starts command mode, while a
  // space (args) or a deleted `/` closes it and reverts to a normal prompt.
  // Tab-accept writes the chosen name back into the textarea.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.onContentChange = () => {
      handleContentChange();
      const t = textareaRef.current?.plainText ?? "";
      const inCommand = t.startsWith("/") && !t.slice(1).includes(" ");
      if (inCommand) {
        if (filterCommands(t.slice(1)).length) loopStore.trigger.openCommand({ query: t.slice(1) });
        else loopStore.trigger.closeCommand();
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
  }, [handleContentChange]);

  const submit = () => {
    if (textareaRef.current?.plainText.trim() === "/") return; // bare slash: just the picker
    const resolved = resolveAndClear();
    onSubmit(resolved.text, resolved.files);
    textareaRef.current?.clear();
  };

  return (
    <box
      flexDirection="row"
      gap={1}
      border={['top', 'bottom']}
      borderColor={commandOpen ? theme.accent : theme.border}
      titleColor={commandOpen ? theme.accent : theme.textMuted}
      title={commandOpen ? ` Command ` : ` Prompt `}
      titleAlignment="right"
      onMouseDown={() => textareaRef.current?.focus()}
    >
      <text fg={commandOpen ? theme.accent : theme.textMuted}> {icons.prompt}</text>
      <box flexGrow={1}>
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