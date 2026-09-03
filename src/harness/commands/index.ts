import { loadCommandCatalog } from "./discovery";
import type { Command } from "./types";

export type { Command, CommandKind } from "./types";

const catalog: Command[] = await loadCommandCatalog();

export const listCommands = (): Command[] => catalog;

/** Discovered skills (`kind: "skill"`), shared by the `skill` flow tool and the system prompt. */
export const listSkills = (): Command[] => catalog.filter((c) => c.kind === "skill");
