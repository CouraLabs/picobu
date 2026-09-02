import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { SyntaxStyle, decodePasteBytes, stripAnsiSequences, type TextareaRenderable } from "@opentui/core";
import { useKeyboard, usePaste } from "@opentui/react";
import { useSelector } from "@xstate/store-react";
import { themeStore } from "../stores/theme-store";
import { clipboardStore } from "../stores/clipboard-store";
import { useClipboard } from "./useClipboard";
import {
  bytesToDataUrl,
  countLines,
  fileEmbedLabel,
  resolvePrompt,
  textEmbedLabel,
  type ResolvedPrompt,
} from "../libs/embeds";
import { readClipboardImage } from "../libs/clipboard";

type EmbedData = {
  key: string;
  label: string;
};

/**
 * Owns the prompt's paste + embedding lifecycle:
 * - intercepts terminal paste and routes text (<=100 lines) through as-is,
 *   long text (>100 lines) into a `T#N` token, and files into a `F#N` token;
 * - renders each token as a virtual extmark (primary-colored, atomic: one
 *   backspace/delete removes the whole token) so it can't be edited in-place;
 * - reconciles removed tokens back to a cleared store entry;
 * - exposes the embed `SyntaxStyle` for the textarea and the submit resolver.
 */
export const usePromptClipboard = (
  textareaRef: RefObject<TextareaRenderable | null>,
) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const { addText, addFile, remove, clear } = useClipboard();
  const extmarkIds = useRef(new Map<string, number>());
  /** Extmarks styling `@path` file links (real text, accent-colored). */
  const linkExtmarkIds = useRef(new Set<number>());
  const reconciling = useRef(false);

  const embedSyntax = useMemo(
    () =>
      SyntaxStyle.fromStyles({
        promptEmbed: { fg: theme.primary },
        promptLink: { fg: theme.accent },
      }),
    [theme.primary, theme.accent],
  );
  const embedStyleId = useMemo(() => embedSyntax.getStyleId("promptEmbed") ?? 0, [embedSyntax]);
  const linkStyleId = useMemo(() => embedSyntax.getStyleId("promptLink") ?? 0, [embedSyntax]);
  useEffect(() => () => embedSyntax.destroy(), [embedSyntax]);

  const insertEmbed = (ta: TextareaRenderable, key: string, label: string): void => {
    const start = ta.editorView.getVisualCursor().offset;
    ta.insertText(label);
    const end = ta.editorView.getVisualCursor().offset;
    const id = ta.extmarks.create({
      start,
      end,
      virtual: true,
      styleId: embedStyleId,
      data: { key, label } satisfies EmbedData,
    });
    extmarkIds.current.set(key, id);
  };

  // Read the host clipboard for an image and embed it as an `F#N` token. Used by
  // both the empty-paste path and the `ctrl+v` keybind.
  const embedClipboardImage = (): void => {
    void readClipboardImage().then((image) => {
      const ta = textareaRef.current;
      if (!image || !ta || !ta.focused) return;
      const key = addFile({
        mimeType: image.mimeType,
        dataUrl: bytesToDataUrl(image.bytes, image.mimeType),
      });
      insertEmbed(ta, key, fileEmbedLabel(key, image.mimeType));
    });
  };

  usePaste((event) => {
    const ta = textareaRef.current;
    if (!ta || !ta.focused) return;

    // We own insertion from here so token creation is atomic; suppress the
    // textarea's own paste handler.
    event.preventDefault();

    const text = stripAnsiSequences(decodePasteBytes(event.bytes));

    // Bracketed paste only carries text. An image (or other non-text) clipboard
    // yields an empty paste, so read the host clipboard's image directly.
    if (text.trim() === "") {
      embedClipboardImage();
      return;
    }

    const lines = countLines(text);
    if (lines > 100) {
      const key = addText(text);
      insertEmbed(ta, key, textEmbedLabel(key, lines));
      return;
    }

    ta.insertText(text);
  });

  // Ghostty (and some other terminals) drops Cmd+V entirely when the clipboard
  // holds no text, so an image paste never reaches `usePaste`. Ctrl+V passes
  // through to the app, so it doubles as the explicit "paste image" keybind.
  useKeyboard((key) => {
    if (!(key.ctrl && key.name === "v")) return;
    const ta = textareaRef.current;
    if (!ta || !ta.focused) return;
    key.preventDefault();
    key.stopPropagation();
    embedClipboardImage();
  });

  /**
   * Insert a `@path` file link at the cursor and accent-style it with a
   * non-virtual extmark: the text stays real (it ships in the prompt so the
   * model sees the reference) and edits adjust the extmark range with it. A
   * trailing space keeps the next keystroke off the token.
   */
  const insertFileLink = useCallback(
    (path: string): void => {
      const ta = textareaRef.current;
      if (!ta) return;
      const label = `@${path}`;
      const start = ta.editorView.getVisualCursor().offset;
      ta.insertText(label + " ");
      const end = ta.editorView.getVisualCursor().offset;
      const id = ta.extmarks.create({
        start,
        end: end - 1, // exclude the trailing space
        virtual: false,
        styleId: linkStyleId,
      });
      linkExtmarkIds.current.add(id);
      ta.focus();
    },
    [textareaRef, linkStyleId],
  );

  const handleContentChange = useCallback(() => {
    if (reconciling.current) return;
    const ta = textareaRef.current;
    if (!ta) return;

    reconciling.current = true;
    try {
      // File links are real text whose extmark range follows edits; drop the
      // styling once the link text is damaged (no store entry to clear).
      for (const id of [...linkExtmarkIds.current]) {
        const ext = ta.extmarks.get(id);
        if (!ext || !ta.getTextRange(ext.start, ext.end).startsWith("@")) {
          linkExtmarkIds.current.delete(id);
        }
      }
      for (const [key, id] of [...extmarkIds.current.entries()]) {
        const ext = ta.extmarks.get(id);
        // Atomically removed by the virtual-extmark delete behavior.
        if (!ext) {
          remove(key);
          extmarkIds.current.delete(key);
          continue;
        }
        const data = ext.data as Partial<EmbedData> | undefined;
        const label = data?.label;
        if (!label) continue;
        // A token that lost its exact text (damaged by an out-of-band edit)
        // is removed in whole and its store entry cleared.
        if (ta.getTextRange(ext.start, ext.end) !== label) {
          const start = ta.editBuffer.offsetToPosition(ext.start);
          const end = ta.editBuffer.offsetToPosition(ext.end);
          if (start && end) ta.deleteRange(start.row, start.col, end.row, end.col);
          remove(key);
          extmarkIds.current.delete(key);
        }
      }
    } finally {
      reconciling.current = false;
    }
  }, [textareaRef, remove]);

  const resolveAndClear = useCallback((): ResolvedPrompt => {
    const ta = textareaRef.current;
    const rawText = ta?.plainText ?? "";
    const state = clipboardStore.getSnapshot().context;
    const resolved = resolvePrompt(rawText, state.textEmbeds, state.fileEmbeds);
    clear();
    extmarkIds.current.clear();
    return resolved;
  }, [textareaRef, clear]);

  return { embedSyntax, handleContentChange, resolveAndClear, insertFileLink };
};