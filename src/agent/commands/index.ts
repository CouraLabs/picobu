import { loadCommandCatalog } from "@agent/commands/discovery.ts";
import type { Command } from "@agent/commands/types.ts";
export type { Command, CommandKind } from "@agent/commands/types.ts";
const catalog: Command[] = await loadCommandCatalog();
export const listCommands = (): Command[] => catalog;


export const listSkills = (): Command[] => catalog.filter((c) => c.kind === "skill");
