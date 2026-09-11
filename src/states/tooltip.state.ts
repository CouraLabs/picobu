import type { JSX } from '@opentui/solid/jsx-runtime'
import { createSignal } from 'solid-js'

export type TooltipPlacement = {
  x: number
  y: number
  width: number
  height: number
}

export type TooltipPosition = 'top' | 'bottom'

export type TooltipOpenState = {
  content: () => JSX.Element
  placement: TooltipPlacement
  maxWidth: number
  position?: TooltipPosition
}

export const TOOLTIP_FALLBACK_HEIGHT = 3
export const TOOLTIP_CLOSE_DELAY_MS = 60
export const TOOLTIP_DEFAULT_MAX_WIDTH = 40

const [state, setState] = createSignal<TooltipOpenState | null>(null)
export const tooltipState = state

let hideTimer: ReturnType<typeof setTimeout> | undefined

const clearHideTimer = (): void => {
  if (hideTimer === undefined) return
  clearTimeout(hideTimer)
  hideTimer = undefined
}

export const openTooltip = (next: TooltipOpenState): void => {
  clearHideTimer()
  setState(next)
}

export const closeTooltip = (): void => {
  clearHideTimer()
  setState(null)
}

export const scheduleTooltipClose = (delayMs: number): void => {
  clearHideTimer()
  hideTimer = setTimeout(() => {
    hideTimer = undefined
    setState(null)
  }, delayMs)
}

export const cancelTooltipClose = (): void => {
  clearHideTimer()
}

export const computeTooltipPosition = (
  placement: TooltipPlacement,
  tooltipSize: { width: number; height: number },
  viewport: { width: number; height: number },
  position?: TooltipPosition,
): { x: number; y: number } => {
  let y: number
  if (position === 'top') {
    y = Math.max(0, placement.y - tooltipSize.height)
  } else if (position === 'bottom') {
    y = Math.min(placement.y + placement.height, Math.max(0, viewport.height - tooltipSize.height))
  } else {
    y = placement.y + placement.height
    if (y + tooltipSize.height > viewport.height) {
      const above = placement.y - tooltipSize.height
      y = above >= 0 ? above : Math.max(0, viewport.height - tooltipSize.height)
    }
  }
  const x = Math.min(Math.max(0, placement.x), Math.max(0, viewport.width - tooltipSize.width))
  return { x, y }
}
