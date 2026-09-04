/** A file pasted into the prompt, kept as a data URL for the AI SDK. */
export type FileEmbedding = {
  mimeType: string;
  filename?: string;
  dataUrl: string;
};

/** A file ready to be handed to the AI SDK's `sendMessage({ files })`. */
export type PromptFile = {
  type: "file";
  mediaType: string;
  url: string;
  filename?: string;
};

export type ResolvedPrompt = {
  text: string;
  files: PromptFile[];
};

/**
 * Matches a complete embedding token: `[T#1 Pasted 1 ~ 200]` or
 * `[F#1 File image/png]`. The key is captured so the placeholder can be mapped
 * back to its stored payload.
 */
const EITHER_TOKEN = /\[([TF])#(\d+) [^\[\]]+\]/g;

export const countLines = (text: string): number => {
  if (!text) return 0;
  return text.split("\n").length;
};

export const textEmbedLabel = (key: string, lineCount: number): string =>
  `[${key} Pasted 1 ~ ${lineCount}]`;

export const fileEmbedLabel = (key: string, mimeType: string): string =>
  `[${key} File ${mimeType}]`;

/** Convert pasted bytes to a `data:` URL keyed off its MIME type. */
export const bytesToDataUrl = (bytes: Uint8Array, mimeType: string): string =>
  `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;

/**
 * Replace every complete embedding token with its stored payload: text tokens
 * inline back into the prompt, file tokens detached into the `files` array.
 * Unknown/cleared keys collapse to an empty string so no placeholder leaks
 * into the sent prompt.
 */
export const resolvePrompt = (
  rawText: string,
  textEmbeds: Record<string, string>,
  fileEmbeds: Record<string, FileEmbedding>,
): ResolvedPrompt => {
  const files: PromptFile[] = [];
  const text = rawText.replace(EITHER_TOKEN, (_match, type: string, id: string) => {
    const key = `${type}#${id}`;
    if (type === "F") {
      const file = fileEmbeds[key];
      if (file) {
        files.push({
          type: "file",
          mediaType: file.mimeType,
          url: file.dataUrl,
          filename: file.filename,
        });
      }
      return "";
    }
    return textEmbeds[key] ?? "";
  });
  return { text, files };
};