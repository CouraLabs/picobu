import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadAgentsMarkdown(cwd: string): Promise<string | undefined> {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    try {
      const content = await readFile(join(cwd, name), "utf8");
      if (content.trim()) return content;
    } catch {
    }
  }
  return undefined;
}
