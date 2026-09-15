import { type BoxRenderable, LayoutEvents } from '@opentui/core'
import { useRenderer } from '@opentui/solid'
import type { JSX } from '@opentui/solid/jsx-runtime'
import { theme } from '@states/theme-state.ts'
import {
  cancelTooltipClose,
  closeTooltip,
  computeTooltipPosition,
  openTooltip,
  scheduleTooltipClose,
  TOOLTIP_CLOSE_DELAY_MS,
  TOOLTIP_DEFAULT_MAX_WIDTH,
  TOOLTIP_FALLBACK_HEIGHT,
  TOOLTIP_OPEN_DELAY_MS,
  type TooltipPlacement,
  type TooltipPosition,
  tooltipState,
} from '@states/tooltip.state.ts'
import { useTerminalDims } from '@tui/hooks/terminal-dims.tsx'
import { createEffect, createMemo, createSignal, createUniqueId, on, onCleanup, onMount, Show } from 'solid-js'

export interface TooltipProps {
  content: JSX.Element
  maxWidth?: number
  position?: TooltipPosition
  children: JSX.Element
}

const TOOLTIP_READY_TIMEOUT_MS = 120

export const Tooltip = (props: TooltipProps) => {
  let anchorRef: BoxRenderable | null = null
  let openTimer: ReturnType<typeof setTimeout> | undefined
  const anchorId = createUniqueId()
  const content = () => props.content

  const clearOpenTimer = (): void => {
    if (openTimer === undefined) return
    clearTimeout(openTimer)
    openTimer = undefined
  }

  const readPlacement = (): TooltipPlacement => {
    const anchor = anchorRef
    if (!anchor) return { x: 0, y: 0, width: 0, height: 0 }
    return { x: anchor.screenX ?? 0, y: anchor.screenY ?? 0, width: anchor.width ?? 0, height: anchor.height ?? 0 }
  }

  const show = (): void => {
    clearOpenTimer()
    const current = tooltipState()
    if (current?.anchorId === anchorId) {
      cancelTooltipClose()
      return
    }
    const next = { anchorId, content, maxWidth: props.maxWidth ?? TOOLTIP_DEFAULT_MAX_WIDTH, position: props.position }
    if (current !== null) {
      openTooltip({ ...next, placement: readPlacement() })
      return
    }
    openTimer = setTimeout(() => {
      openTimer = undefined
      openTooltip({ ...next, placement: readPlacement() })
    }, TOOLTIP_OPEN_DELAY_MS)
  }

  const hide = (): void => {
    clearOpenTimer()
    if (tooltipState()?.anchorId === anchorId) scheduleTooltipClose(TOOLTIP_CLOSE_DELAY_MS)
  }

  onCleanup(() => {
    clearOpenTimer()
    if (tooltipState()?.anchorId === anchorId) closeTooltip()
  })

  return (
    <box ref={(r) => (anchorRef = r)} width={'auto'} flexDirection={'row'} flexShrink={0} onMouseOver={show} onMouseOut={hide}>
      {props.children}
    </box>
  )
}

export const TooltipLayer = () => {
  const renderer = useRenderer()
  const dims = useTerminalDims()
  const [size, setSize] = createSignal<{ width: number; height: number } | undefined>(undefined)
  const [ready, setReady] = createSignal(false)
  let boxRef: BoxRenderable | null = null
  let lastMeasured: { width: number; height: number } | undefined
  let readyTimer: ReturnType<typeof setTimeout> | undefined

  const clearReadyTimer = (): void => {
    if (readyTimer === undefined) return
    clearTimeout(readyTimer)
    readyTimer = undefined
  }

  const applyMeasure = (): void => {
    const r = boxRef
    if (!r || tooltipState() === null) return
    const next = { width: r.width, height: r.height }
    setSize((prev) => (prev?.width === next.width && prev?.height === next.height ? prev : next))
    if (lastMeasured?.width === next.width && lastMeasured?.height === next.height) {
      if (!ready() && next.width > 0 && next.height > 0) setReady(true)
    } else {
      lastMeasured = next
    }
  }

  createEffect(
    on(
      () => tooltipState()?.anchorId,
      () => {
        clearReadyTimer()
        lastMeasured = undefined
        setSize(undefined)
        setReady(false)
        if (tooltipState() !== null) {
          readyTimer = setTimeout(() => {
            readyTimer = undefined
            if (tooltipState() !== null) setReady(true)
          }, TOOLTIP_READY_TIMEOUT_MS)
        }
      },
    ),
  )

  onMount(() => {
    renderer.root.on(LayoutEvents.LAYOUT_CHANGED, applyMeasure)
  })
  onCleanup(() => {
    clearReadyTimer()
    renderer.root.off(LayoutEvents.LAYOUT_CHANGED, applyMeasure)
  })

  const pos = createMemo(() => {
    const s = tooltipState()
    if (!s) return { x: 0, y: 0 }
    const measuredSize = size()
    return computeTooltipPosition(
      s.placement,
      { width: measuredSize?.width ?? s.maxWidth, height: measuredSize?.height ?? TOOLTIP_FALLBACK_HEIGHT },
      { width: dims().width, height: dims().height },
      s.position,
    )
  })

  return (
    <Show when={tooltipState() !== null}>
      <box
        position={'absolute'}
        left={pos().x}
        top={pos().y}
        width={'auto'}
        height={'auto'}
        maxWidth={tooltipState()?.maxWidth ?? TOOLTIP_DEFAULT_MAX_WIDTH}
        borderStyle={'rounded'}
        flexDirection={'column'}
        overflow={'hidden'}
        zIndex={900}
        opacity={ready() ? 1 : 0}
        borderColor={theme().border}
        backgroundColor={theme().backgroundPanel}
        ref={(r: BoxRenderable) => {
          boxRef = r
          applyMeasure()
        }}>
        {tooltipState()?.content?.()}
      </box>
    </Show>
  )
}
