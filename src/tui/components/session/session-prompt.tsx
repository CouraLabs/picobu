import type { MouseEvent, TextareaRenderable } from "@opentui/core";
import { onMount } from "solid-js";
import { theme } from "@states/theme-state.ts";
import { icons } from "@tui/themes/icons.ts";

export type SessionPromptProps = {
  onPrompt: (text: string) => void
  streaming?: boolean
}

export const SessionPrompt = (props: SessionPromptProps) => {
  const { onPrompt } = props
  let textareaRef: TextareaRenderable | null = null

  onMount(() => {
    textareaRef?.focus()
  })

  const queueMode = () => props.streaming === true;
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

    // Widget-relative cell of the click. Mouse events report terminal-absolute
    // coordinates, so subtract the textarea's own screen origin.
    const localX = e.x - textareaRef.screenX;
    const localY = e.y - textareaRef.screenY;
    const visualRow = localY + textareaRef.scrollY;
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
    textareaRef.setCursor(sourceRow, targetCol);
  };

  const submit = () => {
    if (textareaRef?.plainText.trim() === "/") return;
    textareaRef?.plainText && onPrompt(textareaRef?.plainText);
    textareaRef?.clear();
  };
  
  return (
    <box
      flexDirection="row"
      gap={1}
      flexShrink={0}
      border={['top', 'bottom']}
      borderStyle={queueMode() ? "double" : steeringMode ? "heavy" : "single"}
      borderColor={queueMode() ? theme().info : steeringMode ? theme().error : commandOpen ? theme().accent : theme().border}
      titleColor={queueMode() ? theme().info : steeringMode ? theme().error : commandOpen ? theme().accent : theme().textMuted}
      title={queueMode() ? " Prompt - Queue " : steeringMode ? " Prompt Steering " : commandOpen ? " Command " : " Prompt "}
      titleAlignment="right"
      onMouseDown={() => textareaRef?.focus()}
    >
      <text flexShrink={0} fg={queueMode() ? theme().info : steeringMode ? theme().error : commandOpen ? theme().accent : theme().textMuted}>{icons.promptBig}</text>
      <box flexGrow={1} flexShrink={1} onMouseDown={handleMouseDown}>
        <textarea
          ref={(r) => textareaRef = r}
          id="prompt"
          maxHeight={10}
          placeholder={queueMode() ? "Queued until the run finishes…" : "What are we going to build?"}
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