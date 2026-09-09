import { createSignal } from "solid-js";
import { theme } from "@states/theme-state.ts";

export type ButtonProps = {
  id?: string
  isActive?: boolean,
  label: string
  onClick: () => void
};

export const Button = (props: ButtonProps) => {
  const [hovered, setHovered] = createSignal(false);

  return (
    <box
      id={props.id}
      width={"auto"}
      alignSelf={"flex-start"}
      height={1}
      paddingX={1}
      flexDirection={"row"}
      alignItems={"center"}
      backgroundColor={props.isActive ? theme().primary : (hovered() ? theme().accent : theme().backgroundElement)}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={() => props.onClick()}
    >
      <text id={"txt-" + props.id} selectable={false} fg={hovered() ? theme().selected(theme().accent) : theme().accent}>{props.label}</text>
    </box>
  )
}
