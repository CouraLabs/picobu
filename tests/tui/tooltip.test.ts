import { describe, expect, test } from 'bun:test'
import {
  cancelTooltipClose,
  closeTooltip,
  computeTooltipPosition,
  openTooltip,
  scheduleTooltipClose,
  TOOLTIP_CLOSE_DELAY_MS,
  TOOLTIP_FALLBACK_HEIGHT,
  tooltipState,
} from '../../src/states/tooltip.state.ts'

const placement = { x: 5, y: 4, width: 10, height: 1 }

describe('computeTooltipPosition', () => {
  test('defaults below the anchor', () => {
    expect(computeTooltipPosition(placement, { width: 8, height: 3 }, { width: 80, height: 24 })).toEqual({ x: 5, y: 5 })
  })
  test('flips above when the bottom overflows and there is room', () => {
    const anchor = { x: 5, y: 21, width: 10, height: 1 }
    expect(computeTooltipPosition(anchor, { width: 8, height: 3 }, { width: 80, height: 24 })).toEqual({ x: 5, y: 18 })
  })
  test('clamps x into the viewport', () => {
    const anchor = { x: 75, y: 4, width: 10, height: 1 }
    expect(computeTooltipPosition(anchor, { width: 12, height: 3 }, { width: 80, height: 24 })).toEqual({ x: 68, y: 5 })
    expect(computeTooltipPosition({ x: 0, y: 0, width: 1, height: 1 }, { width: 12, height: 3 }, { width: 80, height: 24 })).toEqual({ x: 0, y: 1 })
  })
  test('clamps y when neither side fits', () => {
    const anchor = { x: 5, y: 0, width: 10, height: 22 }
    expect(computeTooltipPosition(anchor, { width: 8, height: 3 }, { width: 80, height: 24 })).toEqual({ x: 5, y: 21 })
  })
  test('tall todo tooltip flips above a bottom-anchored status bar', () => {
    const anchor = { x: 10, y: 20, width: 12, height: 1 }
    expect(computeTooltipPosition(anchor, { width: 30, height: 10 }, { width: 80, height: 24 })).toEqual({ x: 10, y: 10 })
  })
  test("position 'top' places the tooltip above the anchor and clamps at the viewport top", () => {
    const anchor = { x: 10, y: 20, width: 12, height: 1 }
    expect(computeTooltipPosition(anchor, { width: 30, height: 10 }, { width: 80, height: 24 }, 'top')).toEqual({ x: 10, y: 10 })
    expect(computeTooltipPosition({ x: 0, y: 0, width: 12, height: 1 }, { width: 30, height: 10 }, { width: 80, height: 24 }, 'top')).toEqual({ x: 0, y: 0 })
  })
  test("position 'bottom' places the tooltip below the anchor and clamps at the viewport bottom", () => {
    const anchor = { x: 10, y: 4, width: 12, height: 1 }
    expect(computeTooltipPosition(anchor, { width: 30, height: 10 }, { width: 80, height: 24 }, 'bottom')).toEqual({ x: 10, y: 5 })
    expect(computeTooltipPosition({ x: 10, y: 20, width: 12, height: 1 }, { width: 30, height: 10 }, { width: 80, height: 24 }, 'bottom')).toEqual({ x: 10, y: 14 })
  })
  test('measured height replaces fallback so position accounts for all items', () => {
    const anchor = { x: 10, y: 20, width: 12, height: 1 }
    const fallback = computeTooltipPosition(anchor, { width: 30, height: TOOLTIP_FALLBACK_HEIGHT }, { width: 80, height: 24 })
    const measured = computeTooltipPosition(anchor, { width: 30, height: 10 }, { width: 80, height: 24 })
    expect(fallback.y).toBeGreaterThan(measured.y)
    expect(measured.y + 10).toBeLessThanOrEqual(24)
  })
})

describe('tooltip state', () => {
  test('opens with content and closes to null', () => {
    closeTooltip()
    expect(tooltipState()).toBeNull()
    const view = (): string => 'tip'
    openTooltip({ content: view, placement, maxWidth: 20 })
    const open = tooltipState()
    expect(open?.content()).toBe('tip')
    expect(open?.placement).toEqual(placement)
    expect(open?.maxWidth).toBe(20)
    closeTooltip()
    expect(tooltipState()).toBeNull()
  })
  test('constants are usable', () => {
    expect(TOOLTIP_FALLBACK_HEIGHT).toBeGreaterThan(0)
    expect(TOOLTIP_CLOSE_DELAY_MS).toBeGreaterThanOrEqual(0)
    scheduleTooltipClose(0)
    cancelTooltipClose()
  })
})
