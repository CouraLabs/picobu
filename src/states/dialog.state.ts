import type { JSX } from "@opentui/solid/jsx-runtime";
import { createMemo, createSignal } from "solid-js";

export type DialogState = {
  status: "open" | "close";
  content: (() => JSX.Element) | null;
};
const [dialogState, setDialogState] = createSignal<DialogState>({
  status: "close",
  content: null,
});
export const dialogStatus = createMemo(() => dialogState());
export const openDialog = (content: () => JSX.Element) =>
  setDialogState(() => ({
    status: "open",
    content: content,
  }));
let lastCloseAt = 0;
export const closeDialog = () => {
  lastCloseAt = Date.now();
  setDialogState(() => ({
    status: "close",
    content: null,
  }));
};
export const dialogJustClosed = (windowMs = 250): boolean => Date.now() - lastCloseAt < windowMs;
