export interface SubmitTextareaBinding {
  name: string
  action: 'submit' | 'newline'
  shift?: boolean
}

export const COMMENT_TEXTAREA_KEY_BINDINGS: Array<SubmitTextareaBinding> = [
  { name: 'return', action: 'submit' },
  { name: 'kpenter', action: 'submit' },
  { name: 'return', shift: true, action: 'newline' },
  { name: 'kpenter', shift: true, action: 'newline' },
  { name: 'linefeed', action: 'newline' },
]
