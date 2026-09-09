import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { type Command, listSkills } from "@agent/commands/index.ts";
import { parseMarkdownFile } from "@agent/markdown/markdown-parser.ts";
import z from "zod";
export const SkillToolArgsSchema = z.object({
  name: z.string(),
});
export const SkillToolOutputSchema = z.object({
  name: z.string(),
  description: z.string(),
  skillFile: z.string(),
  skillDir: z.string(),
  files: z.array(z.string()),
  content: z.string(),
});

const listSkillFiles = async (dir: string): Promise<string[]> => {
  const files: string[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(current, entry.name), rel);
      else if (entry.isFile()) files.push(rel);
    }
  };
  await walk(dir, "");
  return files.sort();
};

export const createSkillTool = (getSkills: () => Command[] = listSkills) => ({
  name: "skill",
  kind: "flow" as const,
  description: [
    "Load a skill's instructions into the conversation. Pass the exact skill name from the Skills section.",
    "The output carries the skill's SKILL.md content, its folder path (skillDir), and the relative paths of its",
    "related files (files). After loading, follow the instructions; when they reference related files, read them",
    "from skillDir with the read tool.",
    "Users may request several skills at once with /skill:<name> tokens chained at the start of their prompt",
    '(e.g. "/skill:review /skill:tests check this diff"): call the skill tool once per requested skill, then',
    "process the rest of the prompt.",
  ].join(" "),
  parameters: SkillToolArgsSchema,
  output: SkillToolOutputSchema,
  handler: async (args: z.infer<typeof SkillToolArgsSchema>): Promise<z.infer<typeof SkillToolOutputSchema>> => {
    const skills = getSkills();
    const skill = skills.find((s) => s.name.toLowerCase() === args.name.trim().toLowerCase());
    if (!skill) {
      const available = skills.map((s) => s.name).join(", ");
      throw new Error(`Unknown skill: "${args.name}". Available skills: ${available || "(none)"}`);
    }
    const parsed = await parseMarkdownFile(skill.path);
    return {
      name: skill.name,
      description: skill.description,
      skillFile: skill.path,
      skillDir: dirname(skill.path),
      files: await listSkillFiles(dirname(skill.path)),
      content: parsed.content,
    };
  },
});
