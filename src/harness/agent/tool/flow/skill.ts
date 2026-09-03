import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import z from "zod";
import { listSkills, type Command } from "@harness/commands/index.ts";
import { parseMarkdownFile } from "@harness/agent/markdown/markdown-parser.ts";

export const SkillToolArgsSchema = z.object({
  name: z.string(),
});

export const SkillToolOutputSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** SKILL.md path. */
  skillFile: z.string(),
  /** Folder containing the skill; related files live here. */
  skillDir: z.string(),
  /** Relative paths of every file in the skill folder (SKILL.md included). */
  files: z.array(z.string()),
  /** Frontmatter-stripped SKILL.md body. */
  content: z.string(),
});

/** Every file under `dir`, as paths relative to it (dot-files included). */
const listSkillFiles = async (dir: string): Promise<string[]> => {
  const files: string[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries;
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

/**
 * Skill-loading flow tool. Resolves a skill from the discovered catalog
 * (`.agents/skills`, `~/.agents/skills`, `~/.picobu/skills` — same source as
 * the `/`-command picker) and returns its SKILL.md body plus the relative
 * paths of the related files in the skill's folder, so the model can read the
 * ones the instructions reference with the `read` tool.
 */
export const createSkillTool = (getSkills: () => Command[] = listSkills) => ({
  name: "skill",
  kind: "flow" as const,
  description: [
    "Load a skill's instructions into the conversation. Pass the exact skill name from the Skills section.",
    "The output carries the skill's SKILL.md content, its folder path (skillDir), and the relative paths of its",
    "related files (files). After loading, follow the instructions; when they reference related files, read them",
    "from skillDir with the read tool.",
  ].join(" "),
  parameters: SkillToolArgsSchema,
  output: SkillToolOutputSchema,
  handler: async (
    args: z.infer<typeof SkillToolArgsSchema>,
  ): Promise<z.infer<typeof SkillToolOutputSchema>> => {
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
