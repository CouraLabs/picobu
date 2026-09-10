import type { RGBA } from '@opentui/core'
import { useTimeline } from '@opentui/solid'
import { theme } from '@states/theme-state.ts'
import { createEffect, createMemo, createSignal } from 'solid-js'

export type MarqueeProps = {
  content: string
  maxWidth: number
  speed?: number
  fg?: string | RGBA
  fillWidth?: boolean
  scrolling?: boolean
}

export const Marquee = (props: MarqueeProps) => {
  const [hovered, setHovered] = createSignal(false)
  const speedMs = () => props.speed ?? 3000
  const driver = { phase: 0 }
  const timeline = useTimeline({ autoplay: false, duration: speedMs() * 2, loop: true })
  const chars = createMemo(() => Array.from(props.content))
  const overflowCols = createMemo(() => Math.max(0, chars().length - props.maxWidth))
  const sliceWindow = (start: number): string => {
    if (overflowCols() === 0) return props.content
    return chars()
      .slice(start, start + props.maxWidth)
      .join('')
  }
  const [visible, setVisible] = createSignal(sliceWindow(0))

  const resetToHead = (): void => {
    driver.phase = 0
    setVisible(sliceWindow(0))
  }

  timeline.add(driver, {
    phase: 2,
    duration: speedMs() * 2,
    ease: 'linear',
    loop: true,
    onUpdate: () => {
      const tri = driver.phase <= 1 ? driver.phase : 2 - driver.phase
      setVisible(sliceWindow(Math.min(Math.round(tri * overflowCols()), overflowCols())))
    },
  })

  createEffect(() => {
    const isHovered = hovered()
    const overflow = overflowCols()
    const active = (isHovered || props.scrolling === true) && overflow > 0

    if (active && !timeline.isPlaying) {
      resetToHead()
      timeline.restart()
    } else if (!active) {
      timeline.pause()
      resetToHead()
    }
  })

  return (
    <text
      truncate
      selectable={false}
      wrapMode={'none'}
      fg={props.fg ?? theme().text}
      width={overflowCols() > 0 || props.fillWidth ? props.maxWidth : 'auto'}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}>
      {visible()}
    </text>
  )
}
