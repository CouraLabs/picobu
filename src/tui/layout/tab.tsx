import { Button } from "@tui/components/button.tsx";
import { For } from "solid-js";

export type TabProps = {
  curr: string
  tabs: {
    id: string
    label: string
  }[]
  onChange: (tab: string) => void;
}

export const Tab = (props: TabProps) => {
  return (
    <box flexDirection="row" gap={1}>
      <For each={props.tabs}>
        {(item) => <Button isActive={props.curr === item.id} id={item.id} label={item.label} onClick={() => props.onChange(item.id)} />}
      </For>
    </box>
  )
}
