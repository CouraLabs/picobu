import { TextAttributes } from '@opentui/core'
import { theme } from '@states/theme-state.ts'
import { icons } from '@tui/themes/index.ts'
import { getSharedTreeSitterClientSync } from '@wrappers/treesitter-wrapper.ts'
import type { ReasoningUIPart } from 'ai'
import { createSignal, Show } from 'solid-js'

export type ReasoningPartProps = {
  part: ReasoningUIPart
  isStreamingTail: boolean
}

const MAX_REASONING_EXPANDED = 200

const [expandedKeys, setExpandedKeys] = createSignal<ReadonlySet<string>>(new Set())

export const ReasoningPart = (props: ReasoningPartProps) => {
  const [hovered, setHovered] = createSignal(false)
  const [localExpanded, setLocalExpanded] = createSignal(false)
  const key = (): string | undefined => props.part.id
  const expanded = (): boolean => {
    const k = key()
    return k === undefined ? localExpanded() : expandedKeys().has(k)
  }

  const toggle = () => {
    const k = key()
    if (k === undefined) {
      setLocalExpanded((v) => !v)
      return
    }
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else {
        next.add(k)
        while (next.size > MAX_REASONING_EXPANDED) {
          const oldest = next.values().next().value
          if (oldest === undefined) break
          next.delete(oldest)
        }
      }
      return next
    })
  }

  return (
    <box flexDirection="column">
      <box
        flexDirection="row"
        gap={1}
        onMouseOver={(event) => {
          event.stopPropagation()
          setHovered(true)
        }}
        onMouseOut={(event) => {
          event.stopPropagation()
          setHovered(false)
        }}
        onMouseUp={(event) => {
          event.stopPropagation()
          toggle()
        }}>
        <text
          fg={hovered() ? theme().accent : theme().textMuted}
          attributes={hovered() ? TextAttributes.BOLD : undefined}
          selectable={false}>
          {props.isStreamingTail ? 'Thinking' : 'Thoughts'} {expanded() ? icons.collapse : icons.uncollapse}
        </text>
      </box>
      <Show when={expanded()}>
        <markdown
          syntaxStyle={theme().syntaxMuted}
          treeSitterClient={getSharedTreeSitterClientSync()}
          streaming={props.isStreamingTail}
          internalBlockMode={props.isStreamingTail ? 'top-level' : 'coalesced'}
          conceal
          content={props.part.text}
        />
      </Show>
    </box>
  )
}
