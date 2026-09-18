import type { RGBA } from '@opentui/core'
import { useTimeline } from '@opentui/solid'
import { theme } from '@states/theme-state.ts'
import { createEffect, createMemo, createSignal, mergeProps } from 'solid-js'

export interface MarqueeProps {
  content: string
  maxWidth: number
  speed?: number
  fg?: string | RGBA
  fillWidth?: boolean
  scrolling?: boolean
}

export const Marquee = (props: MarqueeProps) => {
  const merged = mergeProps({ speed: 3000 }, props)
  const [hovered, setHovered] = createSignal(false)
  const speedMs = () => merged.speed
  const driver = { phase: 0 }
  const timeline = useTimeline({ autoplay: false, duration: speedMs() * 2, loop: true })
  const chars = createMemo(() => Array.from(merged.content))
  const charCols = (char: string): number => {
    const code = char.codePointAt(0) ?? 0
    if (
      code >= 0x1100 &&
      (code <= 0x115f ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1f300 && code <= 0x1f64f) ||
        (code >= 0x1f900 && code <= 0x1f9ff) ||
        (code >= 0x20000 && code <= 0x3fffd))
    )
      return 2
    return 1
  }
  const widthOf = createMemo(() => chars().reduce((sum, char) => sum + charCols(char), 0))
  const overflowCols = createMemo(() => Math.max(0, widthOf() - merged.maxWidth))
  const sliceWindow = (start: number): string => {
    if (overflowCols() === 0) return merged.content
    const out: Array<string> = []
    let acc = 0
    for (const char of chars()) {
      const cols = charCols(char)
      if (acc >= start && acc + cols <= start + merged.maxWidth) out.push(char)
      acc += cols
      if (acc >= start + merged.maxWidth) break
    }
    return out.join('')
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
    const active = (isHovered || merged.scrolling === true) && overflow > 0

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
      fg={merged.fg ?? theme().text}
      width={overflowCols() > 0 || merged.fillWidth ? merged.maxWidth : 'auto'}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}>
      {visible()}
    </text>
  )
}
