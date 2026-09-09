import { execFileSync } from "node:child_process";

export type GitInfo = {
  branch: string;
  additions: number;
  deletions: number;
};

type CacheEntry = {
  at: number;
  info: GitInfo | null;
};

const TTL_MS = 5000;
const cache = new Map<string, CacheEntry>();

const run = (cwd: string, args: string[]): string | null => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

const parseNumstat = (raw: string): { additions: number; deletions: number } => {
  let additions = 0;
  let deletions = 0;
  for (const line of raw.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const added = Number(parts[0]);
    const removed = Number(parts[1]);
    if (Number.isFinite(added)) additions += added;
    if (Number.isFinite(removed)) deletions += removed;
  }
  return { additions, deletions };
};

export const getGitInfo = (cwd: string): GitInfo | null => {
  const now = Date.now();
  const cached = cache.get(cwd);
  if (cached && now - cached.at < TTL_MS) return cached.info;
  const branchRaw = run(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branchRaw) {
    const entry: CacheEntry = { at: now, info: null };
    cache.set(cwd, entry);
    return null;
  }
  const numstat = run(cwd, ["diff", "HEAD", "--numstat"]) ?? "";
  const { additions, deletions } = parseNumstat(numstat);
  const info: GitInfo = { branch: branchRaw, additions, deletions };
  cache.set(cwd, info ? { at: now, info } : { at: now, info });
  if (cache.size > 32) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return info;
};

export const resetGitInfoCache = (): void => {
  cache.clear();
};
