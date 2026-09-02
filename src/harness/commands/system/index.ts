import type { Command } from "../types";
import { cd } from "./cd";
import { compact } from "./compact";
import { effort } from "./effort";
import { login } from "./login";
import { logout } from "./logout";
import { models } from "./models";
import { modelRoles } from "./model-roles";
import { newSession } from "./new";
import { quit } from "./quit";
import { sessions } from "./sessions";
import { WWP_COMMANDS } from "../whatsapp";

/** Built-in system commands, ordered by first-found precedence. */
export const SYSTEM_COMMANDS: Command[] = [quit, cd, models, effort, modelRoles, newSession, sessions, compact, login, logout, ...WWP_COMMANDS];