import type { JSX } from "@opentui/solid/jsx-runtime";
import { createMemo, createSignal } from "solid-js";

export type DialogSize = "small" | "medium" | "large" | "xlarge";

/** Fraction of the terminal the dialog box occupies per size. */
const SIZE_RATIO: Record<DialogSize, { width: `${number}%`; height: `${number}%` }> = {
  small: { width: "30%", height: "30%" },
  medium: { width: "50%", height: "50%" },
  large: { width: "70%", height: "70%" },
  xlarge: { width: "95%", height: "90%" },
};

export type DialogState = {
  status: 'open' | 'close',
  size: DialogSize | null,
  content: (() => JSX.Element) | null
};

const [dialogState, setDialogState] = createSignal<DialogState>({
  status: 'close',
  size: null,
  content: null
});

export const dialogStatus = createMemo(() => {
  const state = dialogState();

  return {
    status: state.status,
    size: SIZE_RATIO[state.size ?? 'small'],
    content: state.content
  }
});

export const openDialog = (size: DialogSize, content: JSX.Element) => setDialogState(() => ({
  status: 'open',
  size: size,
  content: content
}));

export const closeDialog = () => setDialogState(() => ({
  status: 'close',
  size: null,
  content: null
}));