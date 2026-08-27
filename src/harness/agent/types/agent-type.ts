export type AgentType = {
  name: string;
  description: string;
  tools: string[];
  model?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  prompt: string;
  /** Optional HEX (`#RRGGBB`) color or theme key (e.g. `accent`) shown on the TUI. Defaults to `theme.text` when unset. */
  color?: string;
}