import { theme } from "@states/theme-state.ts"
import type { RGBA } from "@opentui/core"
import { createSignal, onCleanup, onMount } from "solid-js"

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
export const SPINNER_INTERVAL_MS = 80

export const Spinner = (props: { color?: string | RGBA }) => {
  const [frame, setFrame] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => setFrame((f: number) => (f + 1) % SPINNER_FRAMES.length), SPINNER_INTERVAL_MS)
    onCleanup(() => clearInterval(timer))
  })

  return <text fg={props.color ?? theme().textMuted}>{SPINNER_FRAMES[frame()]}</text>
}
