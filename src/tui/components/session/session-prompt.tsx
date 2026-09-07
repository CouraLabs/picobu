
export type SessionPromptProps = {
  onPrompt: (text: string) => void
}

export const SessionPrompt = ({ onPrompt }: SessionPromptProps) => {
  return (
    <box flexDirection="column" flexShrink={1}>
      <box flexDirection="row" border>
        <textarea onSubmit={() => onPrompt("Hi")}></textarea>
      </box>
    </box>
  )
}