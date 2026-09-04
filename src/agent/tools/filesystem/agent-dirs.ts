import { stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { options } from "@config/options.ts";

/**
 * Candidate dirs that extend the agent's behavior (skills, workflows, prompts,
 * commands, rules) and must therefore never be hidden from the filesystem tools
 * — even when dot-prefixed or listed in `.gitignore`.
 */
const AGENT_SUBDIRS = ["skills", "workflows", "prompts", "commands", "rules"];

export const agentDirCandidates = (base: string): string[] => [
  join(base, ".agents"), // the scanned project's own
  join(options.app.cwd, ".agents"), // active working dir (`/cd` keeps it in sync)
  join(options.app.homeDir, ".agents"),
  ...AGENT_SUBDIRS.map((s) => join(options.app.systemDir, s)),
];

const dirExists = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Existing agent dirs strictly inside `base` (deduped, absolute). Only these
 * can contribute files to a search rooted at `base`.
 */
export const agentDirsUnder = async (base: string): Promise<string[]> => {
  const root = resolve(base);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of agentDirCandidates(root)) {
    const dir = resolve(candidate);
    if (seen.has(dir)) continue;
    seen.add(dir);
    const rel = relative(root, dir);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
    if (!(await dirExists(dir))) continue;
    out.push(dir);
  }
  return out;
};

/**
 * True when `path` is inside (or equals) an agent dir: any `<...>/.agents`
 * ancestor, or the picobu systemDir's agent subdirs. Pure path math — the
 * search target exists by construction.
 */
export const insideAgentDir = (path: string): boolean => {
  const systemSubdirs = AGENT_SUBDIRS.map((s) => resolve(join(options.app.systemDir, s)));
  let dir = resolve(path);
  for (;;) {
    if (basename(dir) === ".agents") return true;
    for (const sub of systemSubdirs) {
      const rel = relative(sub, dir);
      if (!rel.startsWith("..") && !isAbsolute(rel)) return true;
    }
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
};
