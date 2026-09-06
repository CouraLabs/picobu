import { stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { options } from "@config/options.ts";


const AGENT_SUBDIRS = ["skills", "workflows", "prompts", "commands", "rules"];
export const agentDirCandidates = (base: string): string[] => [
  join(base, ".agents"),
  join(options.app.cwd, ".agents"),
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
