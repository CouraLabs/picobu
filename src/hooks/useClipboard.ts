import type { UIMessage } from "ai";
import { useSelector } from "@xstate/store-react";
import {
  clipboardStore,
  nextFileKey,
  nextTextKey,
  type ClipboardState,
  type FileEmbedding,
} from "../stores/clipboard-store";

export type UseClipboard = {
  state: ClipboardState;
  addText: (text: string) => string;
  addFile: (file: Pick<FileEmbedding, "mimeType" | "filename" | "dataUrl">) => string;
  remove: (key: string) => void;
  clear: () => void;
};

/**
 * The prompt clipboard: text/file payloads keyed by their embedding token.
 * Kept as a store + hook so any surface can add, reference, or clear pasted
 * content without threading it through props.
 */
export const useClipboard = (): UseClipboard => {
  const state = useSelector(clipboardStore, (s) => s.context);

  const addText = (text: string): string => {
    const key = nextTextKey();
    clipboardStore.trigger.addText({ key, text });
    return key;
  };

  const addFile = (file: Pick<FileEmbedding, "mimeType" | "filename" | "dataUrl">): string => {
    const key = nextFileKey();
    clipboardStore.trigger.addFile({
      key,
      mimeType: file.mimeType,
      filename: file.filename,
      dataUrl: file.dataUrl,
    });
    return key;
  };

  const remove = (key: string): void => clipboardStore.trigger.remove({ key });

  const clear = (): void => clipboardStore.trigger.clear();

  return { state, addText, addFile, remove, clear };
};

type UIPart = UIMessage["parts"][number];

type ToolPartLike = {
  type?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const stringify = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

/**
 * Raw copy payload for a message part. Text/reasoning copy their content
 * verbatim; tool parts copy their tool name, call input, result output (or
 * error) — i.e. everything the `UIMessage` carries for that part.
 */
export const partCopyText = (part: UIPart): string => {
  switch (part.type) {
    case "text":
    case "reasoning":
      return part.text;
    default:
      return toolPartCopyText(part as unknown as ToolPartLike);
  }
};

const toolPartCopyText = (part: ToolPartLike): string => {
  const name =
    part.type === "dynamic-tool"
      ? (part.toolName ?? "")
      : (part.type ?? "").replace(/^tool-/, "");

  const lines: string[] = [];
  if (name) lines.push(name);
  if (part.input !== undefined) lines.push(stringify(part.input));
  if (part.output !== undefined) lines.push(stringify(part.output));
  else if (part.errorText) lines.push(part.errorText);
  return lines.join("\n");
};