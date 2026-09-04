/** Session modes an agent can be bound to: `coding` agents appear only on the
 * coding tab, `persistent` agents only on the persistent tab. */
export type AgentCategory = "coding" | "persistent";

export type AgentType = {
  name: string;
  description: string;
  /** Which session mode the agent is available in. */
  category: AgentCategory;
  tools: string[];
  model?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  prompt: string;
  /** Optional HEX (`#RRGGBB`) color or theme key (e.g. `accent`) shown on the TUI. Defaults to `theme.text` when unset. */
  color?: string;
}