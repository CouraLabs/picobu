import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { options } from "../../libs/options";
import { parseMarkdownFile } from "./markdown/markdown-parser";

/** A discovered rule: markdown file with `name`/`description` frontmatter. */
export type Rule = {
  name: string;
  description: string;
  /** Absolute path of the rule's markdown file. */
  path: string;
};

/** Rule roots, in precedence order (first-found wins). */
const RULE_ROOTS = [
  () => join(options.app.cwd, ".agents", "rules"),
  () => join(options.app.systemDir, "rules"),
  () => join(options.app.homeDir, ".agents", "rules"),
];

const dirExists = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Discover rules from a single root: each `*.md` file becomes a rule
 * (skipped when its frontmatter description is empty).
 */
async function scanRules(root: string, taken: Set<string>, out: Rule[]): Promise<void> {
  if (!(await dirExists(root))) return;
  let files: string[];
  try {
    files = (await readdir(root)).filter((f) => f.endsWith(".md"));
  } catch (err) {
    console.error(`picobu: failed to read rules dir ${root}`, err);
    return;
  }
  for (const file of files) {
    const full = join(root, file);
    try {
      const parsed = await parseMarkdownFile(full);
      const name =
        typeof parsed.name === "string" && parsed.name.trim()
          ? parsed.name.trim()
          : basename(full, extname(full));
      const description = typeof parsed.description === "string" ? parsed.description : "";
      if (!description.trim()) continue; // per spec: skip rules with no description
      const key = name.toLowerCase();
      if (taken.has(key)) continue;
      taken.add(key);
      out.push({ name, description, path: full });
    } catch (err) {
      console.error(`picobu: failed to parse rule ${full}`, err);
    }
  }
}

/**
 * Load the rule catalog from every root in precedence order; on a name
 * collision the earlier entry wins (later duplicates are skipped). Errors in a
 * single file log and skip that entry, never abort.
 */
export const loadRules = async (): Promise<Rule[]> => {
  const rules: Rule[] = [];
  const taken = new Set<string>();
  for (const root of RULE_ROOTS) await scanRules(root(), taken, rules);
  return rules;
};

const catalog: Rule[] = await loadRules();

/** Discovered rules, shared by the `rule` flow tool and the system prompt. */
export const listRules = (): Rule[] => catalog;
