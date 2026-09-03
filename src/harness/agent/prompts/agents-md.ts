import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Load the project's agent instructions from `AGENTS.md` (preferred) or
 * `CLAUDE.md` in `cwd`. Best-effort: when neither file exists (or a read
 * fails) it resolves to `undefined` instead of throwing — the system prompt
 * simply omits the appendix.
 */
export async function loadAgentsMarkdown(cwd: string): Promise<string | undefined> {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    try {
      const content = await readFile(join(cwd, name), "utf8");
      if (content.trim()) return content;
    } catch {
      // missing/unreadable — try the next candidate
    }
  }
  return undefined;
}
