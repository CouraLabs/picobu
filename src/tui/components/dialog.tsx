import { BoxRenderable, RGBA, type MouseEvent } from "@opentui/core"
import { theme } from "@states/theme-state.ts"
import { closeDialog, dialogStatus } from "@states/dialog.state.ts"
import { useKeyboard } from "@opentui/solid"
import { createEffect } from "solid-js"

export const Dialog = () => {
  let ref: BoxRenderable | null = null;

  useKeyboard((key) => {
    if (dialogStatus().status !== "open") return false;
    if (key.name === "escape") {
      closeDialog();
      return true;
    }
    return false;
  })

  const handleBackdropMouseDown = (event: MouseEvent) => {
    if (event.target === event.currentTarget) closeDialog()
  }

  createEffect(() => {
    if (dialogStatus().status === "open") ref?.focus();
  })

  return (
    <box
      position={"absolute"}
      width={"100%"}
      height={"100%"}
      justifyContent={"center"}
      alignItems={"center"}
      backgroundColor={RGBA.fromValues(0, 0, 0, 0.6)}
      visible={dialogStatus().status === 'close' ? false : true}
      zIndex={500}
      focusable={true}
      focused={true}
      onMouseDown={handleBackdropMouseDown}
    >
      <box
        ref={(r) => ref = r}
        borderColor={theme().border}
        focusedBorderColor={theme().borderActive}
        focusable
        borderStyle={"rounded"}
        flexDirection={"column"}
        overflow={"hidden"}
        width={dialogStatus().size.width}
        height={dialogStatus().size.height}
      >
        {dialogStatus().content}
      </box>
    </box>
  )
}

