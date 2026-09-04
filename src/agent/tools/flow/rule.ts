import z from "zod";
import { listRules, type Rule } from "@agent/rules/rules";
import { parseMarkdownFile } from "@agent/markdown/markdown-parser.ts";

export const RuleToolArgsSchema = z.object({
  name: z.string(),
});

export const RuleToolOutputSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** Rule markdown file path. */
  ruleFile: z.string(),
  /** Frontmatter-stripped rule body. */
  content: z.string(),
});

/**
 * Rule-loading flow tool. Resolves a rule from the discovered catalog
 * (`.agents/rules`, `~/.picobu/rules`, `~/.agents/rules`) and returns its
 * frontmatter-stripped body so the model can apply the rule to the current
 * task when its description matches.
 */
export const createRuleTool = (getRules: () => Rule[] = listRules) => ({
  name: "rule",
  kind: "flow" as const,
  description: [
    "Load a rule's instructions into the conversation. Pass the exact rule name from the Rules section.",
    "The output carries the rule's content; apply it to the current task when its description matches.",
  ].join(" "),
  parameters: RuleToolArgsSchema,
  output: RuleToolOutputSchema,
  handler: async (
    args: z.infer<typeof RuleToolArgsSchema>,
  ): Promise<z.infer<typeof RuleToolOutputSchema>> => {
    const rules = getRules();
    const rule = rules.find((r) => r.name.toLowerCase() === args.name.trim().toLowerCase());
    if (!rule) {
      const available = rules.map((r) => r.name).join(", ");
      throw new Error(`Unknown rule: "${args.name}". Available rules: ${available || "(none)"}`);
    }
    const parsed = await parseMarkdownFile(rule.path);
    return {
      name: rule.name,
      description: rule.description,
      ruleFile: rule.path,
      content: parsed.content,
    };
  },
});
