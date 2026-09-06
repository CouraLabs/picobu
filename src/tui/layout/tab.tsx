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

export const Tab = ({ tabs, curr, onChange }: TabProps) => {
  return (
    <box flexDirection="row" gap={1}>
      <For each={tabs}>
        {(item) => <Button isActive={curr === item.id} id={item.id} label={item.label} onClick={() => onChange(item.id)} />}
      </For>
    </box>
  )
}