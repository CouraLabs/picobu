import { readdir, readFile, stat } from "node:fs/promises";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { options } from "@config/options.ts";
import { parseMarkdown, parseMarkdownFile } from "@agent/markdown/markdown-parser.ts";
import type { Command } from "@agent/commands/types.ts";

const skillRoots = (cwd: string): string[] => [
  join(cwd, ".agents", "skills"),
  join(options.app.systemDir, "skills"),
  join(options.app.homeDir, ".agents", "skills"),
];

const workflowRoots = (cwd: string): string[] => [
  join(cwd, ".agents", "workflows"),
  join(cwd, ".agents", "prompts"),
  join(cwd, ".agents", "commands"),
  join(options.app.systemDir, "workflows"),
  join(options.app.systemDir, "prompts"),
  join(options.app.systemDir, "commands"),
  join(options.app.homeDir, ".agents", "workflows"),
  join(options.app.homeDir, ".agents", "prompts"),
  join(options.app.homeDir, ".agents", "commands"),
];

const humanize = (s: string): string =>
  s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");

const collides = (taken: Set<string>, entry: Command): boolean =>
  taken.has(entry.name.toLowerCase()) ||
  entry.aliases.some((a) => taken.has(a.toLowerCase()));

const tryRegister = (taken: Set<string>, list: Command[], entry: Command): boolean => {
  if (collides(taken, entry)) return false;
  list.push(entry);
  taken.add(entry.name.toLowerCase());
  entry.aliases.forEach((a) => taken.add(a.toLowerCase()));
  return true;
};

const dirExists = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
};

const fileExists = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
};

const dirExistsSync = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const fileExistsSync = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

async function scanSkills(root: string, taken: Set<string>, out: Command[]): Promise<void> {
  if (!(await dirExists(root))) return;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    console.error(`picobu: failed to read skills dir ${root}`, err);
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const skillDir = join(root, entry.name);
    const skillFile = join(skillDir, "SKILL.md");
    if (!(await fileExists(skillFile))) continue;
    try {
      const parsed = await parseMarkdownFile(skillFile);
      const name =
        typeof parsed.name === "string" && parsed.name.trim()
          ? parsed.name.trim()
          : entry.name;
      const description = typeof parsed.description === "string" ? parsed.description : "";
      if (!description.trim()) continue;
      tryRegister(taken, out, {
        kind: "skill",
        name,
        aliases: [],
        title: name,
        description,
        path: skillFile,
      });
    } catch (err) {
      console.error(`picobu: failed to parse skill ${skillFile}`, err);
    }
  }
}

async function scanWorkflows(root: string, taken: Set<string>, out: Command[]): Promise<void> {
  if (!(await dirExists(root))) return;
  let files: string[];
  try {
    files = (await readdir(root)).filter((f) => f.endsWith(".md"));
  } catch (err) {
    console.error(`picobu: failed to read workflows dir ${root}`, err);
    return;
  }
  for (const file of files) {
    const full = join(root, file);
    try {
      const parsed = await parseMarkdownFile(full);
      const name =
        typeof parsed.name === "string" && parsed.name.trim()
          ? parsed.name.trim()
          : humanize(basename(full, extname(full)));
      const description = typeof parsed.description === "string" ? parsed.description : "";
      tryRegister(taken, out, {
        kind: "workflow",
        name,
        aliases: [],
        title: name,
        description,
        path: full,
      });
    } catch (err) {
      console.error(`picobu: failed to parse workflow ${full}`, err);
    }
  }
}

function scanSkillsSync(root: string, taken: Set<string>, out: Command[]): void {
  if (!dirExistsSync(root)) return;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    console.error(`picobu: failed to read skills dir ${root}`, err);
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const skillDir = join(root, entry.name);
    const skillFile = join(skillDir, "SKILL.md");
    if (!fileExistsSync(skillFile)) continue;
    try {
      const parsed = parseMarkdown(readFileSync(skillFile, "utf8"));
      const name =
        typeof parsed.name === "string" && parsed.name.trim()
          ? parsed.name.trim()
          : entry.name;
      const description = typeof parsed.description === "string" ? parsed.description : "";
      if (!description.trim()) continue;
      tryRegister(taken, out, {
        kind: "skill",
        name,
        aliases: [],
        title: name,
        description,
        path: skillFile,
      });
    } catch (err) {
      console.error(`picobu: failed to parse skill ${skillFile}`, err);
    }
  }
}

function scanWorkflowsSync(root: string, taken: Set<string>, out: Command[]): void {
  if (!dirExistsSync(root)) return;
  let files: string[];
  try {
    files = readdirSync(root).filter((f) => f.endsWith(".md"));
  } catch (err) {
    console.error(`picobu: failed to read workflows dir ${root}`, err);
    return;
  }
  for (const file of files) {
    const full = join(root, file);
    try {
      const parsed = parseMarkdown(readFileSync(full, "utf8"));
      const name =
        typeof parsed.name === "string" && parsed.name.trim()
          ? parsed.name.trim()
          : humanize(basename(full, extname(full)));
      const description = typeof parsed.description === "string" ? parsed.description : "";
      tryRegister(taken, out, {
        kind: "workflow",
        name,
        aliases: [],
        title: name,
        description,
        path: full,
      });
    } catch (err) {
      console.error(`picobu: failed to parse workflow ${full}`, err);
    }
  }
}

export const loadCommandCatalog = async (cwd: string = options.app.cwd): Promise<Command[]> => {
  const cmd: Command[] = [];
  const taken = new Set<string>();
  for (const root of skillRoots(cwd)) await scanSkills(root, taken, cmd);
  for (const root of workflowRoots(cwd)) await scanWorkflows(root, taken, cmd);
  return cmd;
};

export const loadCommandCatalogSync = (cwd: string = options.app.cwd): Command[] => {
  const cmd: Command[] = [];
  const taken = new Set<string>();
  for (const root of skillRoots(cwd)) scanSkillsSync(root, taken, cmd);
  for (const root of workflowRoots(cwd)) scanWorkflowsSync(root, taken, cmd);
  return cmd;
};

const commandParams = (rest: string): { param: string; value: string }[] => [
  { param: "{APP_NAME}", value: options.app.name },
  { param: "{APP_CWD}", value: options.app.cwd },
  { param: "{APP_OS}", value: options.app.os },
  { param: "{APP_SHELL}", value: options.app.shell },
  { param: "{USER_PROMPT}", value: rest },
];

export const buildCommandPrompt = async (cmd: Command, rest: string): Promise<string> => {
  if (cmd.kind === "workflow") {
    const raw = await readFile(cmd.path, "utf8");
    const hadUser = parseMarkdown(raw).content.includes("{USER_PROMPT}");
    const parsed = parseMarkdown(raw, commandParams(rest));
    let content = parsed.content;
    if (rest.trim() && !hadUser) content += "\n\nUser request:\n" + rest;
    return content;
  }
  const parsed = await parseMarkdownFile(cmd.path, commandParams(rest));
  let content = `[Skill: ${cmd.title}]\n${cmd.description}\n\n${parsed.content}`;
  if (rest.trim()) content += "\n\nUser request:\n" + rest;
  return content;
}
