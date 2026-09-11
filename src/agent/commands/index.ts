import { loadCommandCatalogSync } from '@agent/commands/discovery.ts'
import type { Command } from '@agent/commands/types.ts'
import { options } from '@config/options.ts'

export type { Command, CommandKind } from '@agent/commands/types.ts'

export const listCommands = (cwd: string = options.app.cwd): Array<Command> => loadCommandCatalogSync(cwd)

export const listSkills = (cwd: string = options.app.cwd): Array<Command> => loadCommandCatalogSync(cwd).filter((c) => c.kind === 'skill')
