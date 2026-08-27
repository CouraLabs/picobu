import { useEffect, useState } from "react";

export type GitStatus = {
  branch: string;
  additions: number;
  deletions: number;
  isRepo: boolean;
};

type Proc = { stdout: Buffer; exitCode: number };

/** Run a git command in the harness cwd and return trimmed stdout, or "" on failure. */
const gitOut = (args: string[]): string => {
  try {
    const proc = Bun.spawnSync({
      cmd: ["git", ...args],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    }) as Proc;
    return proc.exitCode === 0 ? proc.stdout.toString().trim() : "";
  } catch {
    return "";
  }
};

/** Sum the +/- column counts from `git diff --numstat` output (non-numeric = binary, skipped). */
const sumDiffs = (numstat: string): { additions: number; deletions: number } => {
  let additions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n")) {
    const [add, del] = line.split("\t");
    const a = add ? Number.parseInt(add, 10) : NaN;
    const d = del ? Number.parseInt(del, 10) : NaN;
    if (!Number.isNaN(a)) additions += a;
    if (!Number.isNaN(d)) deletions += d;
  }
  return { additions, deletions };
};

/** Read the repo's current branch and unstaged + staged +/- counts from disk. */
const readGitStatus = (): GitStatus => {
  const branch = gitOut(["branch", "--show-current"]);
  if (!branch) return { branch: "", additions: 0, deletions: 0, isRepo: false };

  const unstaged = sumDiffs(gitOut(["diff", "--numstat"]));
  const staged = sumDiffs(gitOut(["diff", "--cached", "--numstat"]));
  return {
    branch,
    additions: unstaged.additions + staged.additions,
    deletions: unstaged.deletions + staged.deletions,
    isRepo: true,
  };
};

/**
 * Live git info for the model status bar: current branch plus the number of
 * added/deleted lines across the working tree (staged and unstaged), refreshed
 * on an interval so edits to the repo are reflected without a restart.
 */
export const useGitStatus = (intervalMs = 3000): GitStatus => {
  const [status, setStatus] = useState<GitStatus>(readGitStatus);
  useEffect(() => {
    const id = setInterval(() => setStatus(readGitStatus()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return status;
};