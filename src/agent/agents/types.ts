export type AgentCategory = "coding" | "persistent";
export type AgentType = {
  name: string;
  description: string;
  category: AgentCategory;
  tools: string[];
  model?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  prompt: string;
  color?: string;
};
