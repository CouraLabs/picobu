import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { options } from "@config/options.ts";
import { parseMarkdownFile } from "@agent/markdown/markdown-parser.ts";


export type Rule = {
  name: string;
  description: string;
  path: string;
};


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
      if (!description.trim()) continue; 
      const key = name.toLowerCase();
      if (taken.has(key)) continue;
      taken.add(key);
      out.push({ name, description, path: full });
    } catch (err) {
      console.error(`picobu: failed to parse rule ${full}`, err);
    }
  }
}


export const loadRules = async (): Promise<Rule[]> => {
  const rules: Rule[] = [];
  const taken = new Set<string>();
  for (const root of RULE_ROOTS) await scanRules(root(), taken, rules);
  return rules;
};
const catalog: Rule[] = await loadRules();


export const listRules = (): Rule[] => catalog;
