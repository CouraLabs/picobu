import { createHostClipboard, type HostClipboardService } from "@opentui/core";

/**
 * Image MIME types we accept when reading a pasted image from the host
 * clipboard, ordered by preference. The first type present wins.
 */
const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type ClipboardImage = {
  mimeType: string;
  bytes: Uint8Array;
};

// The native clipboard service loads the Zig FFI render lib; create it once and
// reuse for the process lifetime instead of per paste.
let host: HostClipboardService | undefined;

const getHost = () => (host ??= createHostClipboard());

/**
 * Read an image off the host (OS) clipboard. Bracketed paste only ever
 * carries text, so an image paste has to be fetched directly from the system
 * clipboard rather than from the paste event. Returns null when the clipboard
 * holds no image or the read fails.
 */
export const readClipboardImage = async (): Promise<ClipboardImage | null> => {
  try {
    const result = await getHost().read({ preferredTypes: IMAGE_MIME_TYPES });

    if (result.status !== "read") return null;
    return {
      mimeType: result.representation.mimeType,
      bytes: result.representation.bytes,
    };
  } catch {
    return null;
  }
};