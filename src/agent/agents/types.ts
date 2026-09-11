export type AgentCategory = 'coding' | 'persistent'
export interface AgentType {
  name: string
  description: string
  category: AgentCategory
  tools: Array<string>
  model?: string
  temperature?: number
  topP?: number
  topK?: number
  prompt: string
  color?: string
}
