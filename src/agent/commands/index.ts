import { loadCommandCatalogSync } from "@agent/commands/discovery.ts";
import { options } from "@config/options.ts";
import type { Command } from "@agent/commands/types.ts";

export type { Command, CommandKind } from "@agent/commands/types.ts";

export const listCommands = (cwd: string = options.app.cwd): Command[] => loadCommandCatalogSync(cwd);

export const listSkills = (cwd: string = options.app.cwd): Command[] =>
  loadCommandCatalogSync(cwd).filter((c) => c.kind === "skill");
