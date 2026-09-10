import { RGBA } from '@opentui/core'
import { icons } from '@tui/themes/icons.ts'

export const lerpColor = (from: RGBA, to: RGBA, t: number): RGBA => {
  const [r1, g1, b1, a1] = from.toInts()
  const [r2, g2, b2] = to.toInts()
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t)
  return RGBA.fromInts(mix(r1, r2), mix(g1, g2), mix(b1, b2), a1)
}

export const contextBar = (percent: number | undefined): string => {
  const cells = 10
  if (percent === undefined) return `${icons.gaugeLeft}${icons.outlineSquare.repeat(cells)}${icons.gaugeRight}`
  const clamped = Math.min(100, Math.max(0, percent))
  const full = Math.floor(clamped / 10)
  const half = clamped % 10 >= 5 ? 1 : 0
  return `${icons.gaugeLeft}${icons.square.repeat(full)}${half ? icons.halfSquare : ''}${icons.outlineSquare.repeat(cells - full - half)}${icons.gaugeRight}`
}

export const contextIcon = (percent: number | undefined): string => {
  if (percent === undefined || percent <= 0) return ''
  if (percent <= 1) return '⠁ '
  if (percent < 5) return '⠃ '
  if (percent < 10) return '⠇ '
  if (percent < 20) return '⡇ '
  if (percent < 30) return '⡏ '
  if (percent < 40) return '⡟ '
  if (percent < 45) return '⡿ '
  if (percent < 50) return '⣿ '
  if (percent < 55) return '⣿⠁'
  if (percent < 60) return '⣿⠃'
  if (percent < 65) return '⣿⠇'
  if (percent < 70) return '⣿⡇'
  if (percent < 80) return '⣿⡏'
  if (percent < 90) return '⣿⡟'
  if (percent < 99) return '⣿⣷'
  return '⣿⣿'
}
