import { collapseSeparators, lineHasVisibleItem, type SessionHeaderItem, type SessionHeaderLayout, type SessionStatusLayout } from '@config/session-layout.ts'
import { createMemo, For, Show } from 'solid-js'
import { HeaderItemView, type HeaderRenderContext, headerItemHasContent } from './header-items.tsx'
import { StatusItemView, type StatusRenderContext, statusItemHasContent } from './status-items.tsx'

export const StatusLines = (props: { layout: SessionStatusLayout; ctx: StatusRenderContext }) => {
  const visible = (item: Parameters<typeof statusItemHasContent>[0]) => item === 'separator' || statusItemHasContent(item, props.ctx)
  return (
    <box flexDirection="column" rowGap={props.layout.rowGap} flexShrink={0}>
      <For each={props.layout.lines}>
        {(line) => {
          const collapsed = createMemo(() => collapseSeparators(line, visible))
          return (
            <Show when={lineHasVisibleItem(line, visible)}>
              <box flexDirection="row" columnGap={props.layout.columnGap} flexShrink={0} flexWrap="wrap">
                <For each={collapsed()}>{(item, index) => <StatusItemView item={item} ctx={props.ctx} previousItem={index() === 0 ? undefined : collapsed()[index() - 1]} />}</For>
              </box>
            </Show>
          )
        }}
      </For>
    </box>
  )
}

export const HeaderLine = (props: { layout: SessionHeaderLayout; ctx: HeaderRenderContext }) => {
  const visible = (item: SessionHeaderItem) => item === 'separator' || headerItemHasContent(item)
  const line = () => props.layout.lines[0] ?? []
  return (
    <Show when={lineHasVisibleItem(line(), visible)}>
      <box flexDirection="row" columnGap={props.layout.columnGap} justifyContent="space-between" alignItems="space-between" flexGrow={1} flexShrink={0} flexWrap="wrap">
        <For each={collapseSeparators(line(), visible)}>{(item) => <HeaderItemView item={item} ctx={props.ctx} />}</For>
      </box>
    </Show>
  )
}
