import { theme } from '@states/theme-state.ts'
import { createSignal } from 'solid-js'

export type ButtonProps = {
  id?: string
  isActive?: boolean
  label: string
  onClick: () => void
}

export const Button = (props: ButtonProps) => {
  const [hovered, setHovered] = createSignal(false)
  const background = () => (props.isActive ? theme().primary : hovered() ? theme().accent : theme().backgroundElement)
  const foreground = () => (props.isActive || hovered() ? theme().selected(background()) : theme().accent)

  return (
    <box
      id={props.id}
      width={'auto'}
      alignSelf={'flex-start'}
      height={1}
      paddingX={1}
      flexDirection={'row'}
      alignItems={'center'}
      backgroundColor={background()}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={() => props.onClick()}>
      <text id={`txt-${props.id}`} selectable={false} fg={foreground()}>
        {props.label}
      </text>
    </box>
  )
}
