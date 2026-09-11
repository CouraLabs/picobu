export type CommandKind = 'system' | 'workflow' | 'skill'
export interface Command {
  kind: CommandKind
  name: string
  aliases: Array<string>
  title: string
  description: string
  path: string
  content?: string
}
