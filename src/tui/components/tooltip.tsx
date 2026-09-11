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
  type TooltipPosition,
  tooltipState,
} from '@states/tooltip.state.ts'
import { createEffect, createSignal, on, onCleanup, onMount, Show } from 'solid-js'

export interface TooltipProps {
  content: JSX.Element
  maxWidth?: number
  position?: TooltipPosition
  children: JSX.Element
}

export const Tooltip = (props: TooltipProps) => {
  let anchorRef: BoxRenderable | null = null

  onCleanup(() => closeTooltip())

  return (
    <box
      ref={(r) => (anchorRef = r)}
      width={'auto'}
      flexDirection={'row'}
      flexShrink={0}
      onMouseOver={() => {
        const anchor = anchorRef
        if (!anchor) return
        openTooltip({
          content: () => props.content,
          placement: { x: anchor.screenX, y: anchor.screenY, width: anchor.width, height: anchor.height },
          maxWidth: props.maxWidth ?? TOOLTIP_DEFAULT_MAX_WIDTH,
          position: props.position,
        })
      }}
      onMouseOut={() => scheduleTooltipClose(TOOLTIP_CLOSE_DELAY_MS)}>
      {props.children}
    </box>
  )
}

export const TooltipLayer = () => {
  const renderer = useRenderer()
  const [size, setSize] = createSignal<{ width: number; height: number } | undefined>(undefined)
  let boxRef: BoxRenderable | null = null

  const applyMeasure = (): void => {
    const r = boxRef
    if (!r) return
    setSize((prev) => (prev?.width === r.width && prev?.height === r.height ? prev : { width: r.width, height: r.height }))
  }

  createEffect(
    on(
      () => tooltipState()?.content,
      () => setSize(undefined),
    ),
  )

  onMount(() => {
    renderer.root.on(LayoutEvents.LAYOUT_CHANGED, applyMeasure)
  })
  onCleanup(() => {
    renderer.root.off(LayoutEvents.LAYOUT_CHANGED, applyMeasure)
  })

  const pos = () => {
    const s = tooltipState()
    if (!s) return { x: 0, y: 0 }
    const measuredSize = size()
    return computeTooltipPosition(
      s.placement,
      { width: measuredSize?.width ?? s.maxWidth, height: measuredSize?.height ?? TOOLTIP_FALLBACK_HEIGHT },
      { width: renderer.width, height: renderer.height },
      s.position,
    )
  }

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
        borderColor={theme().border}
        backgroundColor={theme().backgroundPanel}
        ref={(r: BoxRenderable) => {
          boxRef = r
          applyMeasure()
        }}
        onMouseOver={() => cancelTooltipClose()}
        onMouseOut={() => scheduleTooltipClose(TOOLTIP_CLOSE_DELAY_MS)}>
        {tooltipState()?.content?.()}
      </box>
    </Show>
  )
}
