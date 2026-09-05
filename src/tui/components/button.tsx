import { createSignal } from "solid-js";
import { theme } from "@states/theme-state.ts";

export type ButtonProps = {
  label: string
  onClick: () => void
};

export const Button = ({ label, onClick }: ButtonProps) => {
  const [hovered, setHovered] = createSignal(false);

  return (
    <box
      width={"auto"}
      alignSelf={"flex-start"}
      height={1}
      paddingX={2}
      flexDirection={"row"}
      alignItems={"center"}
      backgroundColor={hovered() ? theme().accent : theme().backgroundElement}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={() => onClick()}
    >
      <text selectable={false} fg={hovered() ? theme().selected(theme().accent) : theme().accent}>{label}</text>
    </box>
  )
}