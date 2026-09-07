import { createSignal } from "solid-js";
import { theme } from "@states/theme-state.ts";

export type ButtonProps = {
  id?: string
  isActive?: boolean,
  label: string
  onClick: () => void
};

export const Button = ({ id, isActive, label, onClick }: ButtonProps) => {
  const [hovered, setHovered] = createSignal(false);

  return (
    <box
      id={id}
      width={"auto"}
      alignSelf={"flex-start"}
      height={1}
      paddingX={1}
      flexDirection={"row"}
      alignItems={"center"}
      backgroundColor={isActive ? theme().primary : (hovered() ? theme().accent : theme().backgroundElement)}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={() => onClick()}
    >
      <text id={"txt-" + id} selectable={false} fg={hovered() ? theme().selected(theme().accent) : theme().accent}>{label}</text>
    </box>
  )
}