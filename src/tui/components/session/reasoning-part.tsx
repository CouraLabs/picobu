import { theme } from "@states/theme-state.ts"
import { TextAttributes } from "@opentui/core"
import { icons } from "@tui/themes/index.ts"
import { getSharedTreeSitterClientSync } from "@wrappers/treesitter-wrapper.ts"
import type { ReasoningUIPart } from "ai"
import { createSignal, Show } from "solid-js"

export type ReasoningPartProps = {
  part: ReasoningUIPart
  isStreamingTail: boolean
}

const [expandedKeys, setExpandedKeys] = createSignal<ReadonlySet<string>>(new Set())

export const ReasoningPart = (props: ReasoningPartProps) => {
  const [hovered, setHovered] = createSignal(false)
  const expanded = (): boolean => expandedKeys().has(props.part.text)

  const toggle = () => {
    const key = props.part.text
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <box flexDirection="column">
      <box
        flexDirection="row" gap={1}
        onMouseOver={(event) => { event.stopPropagation(); setHovered(true) }}
        onMouseOut={(event) => { event.stopPropagation(); setHovered(false) }}
        onMouseUp={(event) => { event.stopPropagation(); toggle() }}
      >
        <text
          fg={hovered() ? theme().accent : theme().textMuted}
          attributes={hovered() ? TextAttributes.BOLD : undefined}
          selectable={false}
        >
          {expanded() ? icons.collapse : icons.uncollapse} {props.isStreamingTail ? "Thinking" : "Thoughts"}
        </text>
      </box>
      <Show when={expanded()}>
        <markdown
          syntaxStyle={theme().syntaxMuted}
          treeSitterClient={getSharedTreeSitterClientSync()}
          streaming={props.isStreamingTail}
          internalBlockMode={props.isStreamingTail ? "top-level" : "coalesced"}
          conceal
          content={props.part.text}
        />
      </Show>
    </box>
  )
}
