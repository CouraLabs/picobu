import type { JSX } from "@opentui/solid/jsx-runtime";
import { createMemo, createSignal } from "solid-js";

export type DialogState = {
  status: 'open' | 'close',
  content: (() => JSX.Element) | null
};
const [dialogState, setDialogState] = createSignal<DialogState>({
  status: 'close',
  content: null
});
export const dialogStatus = createMemo(() => dialogState());
export const openDialog = (content: () => JSX.Element) => setDialogState(() => ({
  status: 'open',
  content: content
}));
export const closeDialog = () => setDialogState(() => ({
  status: 'close',
  content: null
}));
