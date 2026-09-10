export type CommandKind = 'system' | 'workflow' | 'skill'
export type Command = {
  kind: CommandKind
  name: string
  aliases: string[]
  title: string
  description: string
  path: string
  content?: string
}
