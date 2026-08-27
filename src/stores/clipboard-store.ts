import { createStore } from "@xstate/store-react";

/**
 * A file that was pasted into the prompt, kept as a data URL so it can be
 * handed to the AI SDK verbatim (`FileUIPart`) once the prompt is fired.
 */
export type FileEmbedding = {
  mimeType: string;
  filename?: string;
  dataUrl: string;
};

export type ClipboardState = {
  /** Text embeddings keyed by their token, e.g. `T#1`. */
  textEmbeds: Record<string, string>;
  /** File embeddings keyed by their token, e.g. `F#1`. */
  fileEmbeds: Record<string, FileEmbedding>;
  nextTextId: number;
  nextFileId: number;
};

export const clipboardStore = createStore({
  context: {
    textEmbeds: {},
    fileEmbeds: {},
    nextTextId: 1,
    nextFileId: 1,
  } as ClipboardState,
  on: {
    addText: (state, event: { key: string; text: string }) => ({
      ...state,
      textEmbeds: { ...state.textEmbeds, [event.key]: event.text },
      nextTextId: state.nextTextId + 1,
    }),
    addFile: (
      state,
      event: { key: string; mimeType: string; filename?: string; dataUrl: string },
    ) => ({
      ...state,
      fileEmbeds: {
        ...state.fileEmbeds,
        [event.key]: { mimeType: event.mimeType, filename: event.filename, dataUrl: event.dataUrl },
      },
      nextFileId: state.nextFileId + 1,
    }),
    remove: (state, event: { key: string }) => {
      if (!(event.key in state.textEmbeds) && !(event.key in state.fileEmbeds)) {
        return state;
      }
      const textEmbeds = { ...state.textEmbeds };
      const fileEmbeds = { ...state.fileEmbeds };
      delete textEmbeds[event.key];
      delete fileEmbeds[event.key];
      return { ...state, textEmbeds, fileEmbeds };
    },
    clear: (state) => ({
      ...state,
      textEmbeds: {},
      fileEmbeds: {},
    }),
  },
});

/** Reserves the next text token key without mutating the store; pair with `addText`. */
export const nextTextKey = (): string => `T#${clipboardStore.getSnapshot().context.nextTextId}`;

/** Reserves the next file token key without mutating the store; pair with `addFile`. */
export const nextFileKey = (): string => `F#${clipboardStore.getSnapshot().context.nextFileId}`;