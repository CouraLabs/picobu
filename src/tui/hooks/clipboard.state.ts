import type { ClipboardService } from "@opentui/core"

// Module state rather than a Solid provider: the opentui reconciler creates
// nested components outside the provider's owner, so `useContext` misses the
// value for anything mounted below the app root (e.g. dialog content).
let service: ClipboardService | null = null

export const setClipboardService = (next: ClipboardService | null): void => {
  service = next
}

export const getClipboardService = (): ClipboardService | null => service
