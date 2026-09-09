import type { MouseEvent, TextareaRenderable } from "@opentui/core";
import { onMount } from "solid-js";
import { theme } from "@states/theme-state.ts";
import { icons } from "@tui/themes/icons.ts";

export type SessionPromptProps = {
  onPrompt: (text: string) => void
  streaming?: boolean
  waiting?: boolean
}

export const SessionPrompt = (props: SessionPromptProps) => {
  let textareaRef: TextareaRenderable | null = null

  onMount(() => {
    textareaRef?.focus()
  })

  const queueMode = () => props.streaming === true;
  const waitingMode = () => props.waiting === true;
  const steeringMode = false;
  const commandOpen = false;

  const handleMouseDown = (e: MouseEvent) => {
    if (!textareaRef) return
    textareaRef.focus();
    const info = textareaRef.editorView.getLineInfo();
    const lineSources = info.lineSources;
    const lineStartCols = info.lineStartCols;
    const lineWidthCols = info.lineWidthCols;
    if (!lineSources.length) return;
    const localX = e.x - textareaRef.screenX;
    const localY = e.y - textareaRef.screenY;
    const visualRow = localY + textareaRef.scrollY;
    const col = Math.max(0, localX);
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
      const last = lineSources.length - 1;
      sourceRow = lineSources[last] ?? 0;
      baseCol = lineStartCols[last] ?? 0;
      maxCol = (lineStartCols[last] ?? 0) + (lineWidthCols[last] ?? 0);
    }
    const targetCol = Math.min(Math.max(col, baseCol), Math.max(baseCol, maxCol));
    textareaRef.setCursor(sourceRow, targetCol);
  };

  const submit = () => {
    if (waitingMode()) return;
    const text = textareaRef?.plainText ?? "";
    if (text.trim().length === 0) return;
    if (text.trim() === "/") return;
    props.onPrompt(text);
    textareaRef?.clear();
  };

  const borderColor = () => waitingMode() ? theme().info : queueMode() ? theme().info : steeringMode ? theme().error : commandOpen ? theme().accent : theme().border
  const titleColor = () => waitingMode() ? theme().info : queueMode() ? theme().info : steeringMode ? theme().error : commandOpen ? theme().accent : theme().textMuted
  const title = () => waitingMode() ? " Prompt - Waiting " : queueMode() ? " Prompt - Queue " : steeringMode ? " Prompt Steering " : commandOpen ? " Command " : " Prompt "
  const placeholder = () => waitingMode() ? "Answer the questions above…" : queueMode() ? "Queued until the run finishes…" : "What are we going to build?"

  return (
    <box
      flexDirection="row"
      gap={1}
      flexShrink={0}
      border={['top', 'bottom']}
      borderStyle={queueMode() || waitingMode() ? "double" : steeringMode ? "heavy" : "single"}
      borderColor={borderColor()}
      titleColor={titleColor()}
      title={title()}
      titleAlignment="right"
      onMouseDown={() => textareaRef?.focus()}
    >
      <text flexShrink={0} fg={waitingMode() ? theme().info : queueMode() ? theme().info : steeringMode ? theme().error : commandOpen ? theme().accent : theme().textMuted}>{icons.promptBig}</text>
      <box flexGrow={1} flexShrink={1} onMouseDown={handleMouseDown}>
        <textarea
          ref={(r) => textareaRef = r}
          id="prompt"
          maxHeight={10}
          placeholder={placeholder()}
          placeholderColor={theme().textMuted}
          cursorColor={theme().accent}
          textColor={theme().text}
          onSubmit={submit}
          keyBindings={[
            { name: "return", action: "submit" },
            { name: "return", shift: true, action: "newline" },
          ]}
        />
      </box>
    </box>
  )
}
