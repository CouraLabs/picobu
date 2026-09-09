import type { ClipboardService } from "@opentui/core"

let service: ClipboardService | null = null

export const setClipboardService = (next: ClipboardService | null): void => {
  service = next
}

export const getClipboardService = (): ClipboardService | null => service
