import { BoxRenderable, RGBA, type MouseEvent } from "@opentui/core"
import { theme } from "@states/theme-state.ts"
import { closeDialog, dialogStatus } from "@states/dialog.state.ts"
import { useKeyboard } from "@opentui/solid"
import { createEffect } from "solid-js"

export const Dialog = () => {
  let backdropRef: BoxRenderable | null = null;
  let panelRef: BoxRenderable | null = null;

  useKeyboard((key) => {
    if (dialogStatus().status !== "open") return false;
    if (key.name === "escape") {
      closeDialog();
      return true;
    }
    return false;
  })

  const handleBackdropMouseDown = (event: MouseEvent) => {
    if (event.target === backdropRef) closeDialog()
  }

  createEffect(() => {
    if (dialogStatus().status === "open") panelRef?.focus();
  })

  return (
    <box
      ref={(r) => backdropRef = r}
      position={"absolute"}
      width={"100%"}
      height={"100%"}
      justifyContent={"center"}
      alignItems={"center"}
      backgroundColor={RGBA.fromValues(0, 0, 0, 0.6)}
      visible={dialogStatus().status === 'close' ? false : true}
      zIndex={500}
      focusable={true}
      focused={dialogStatus().status === "open"}
      onMouseDown={handleBackdropMouseDown}
    >
      <box
        ref={(r) => panelRef = r}
        backgroundColor={theme().backgroundPanel}
        focusable
        flexDirection={"column"}
        overflow={"hidden"}
        width={"auto"}
        height={"auto"}
        maxWidth={"90%"}
        maxHeight={"90%"}
      >
        {/* Invoke the factory here, inside the renderer context — creating these
            nodes in async code (e.g. a catch block after `await`) has no
            RendererContext and throws "No renderer found". */}
        {dialogStatus().content?.()}
      </box>
    </box>
  )
}
