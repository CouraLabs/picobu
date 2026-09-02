import type { Command } from "../types";
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
export const SYSTEM_COMMANDS: Command[] = [quit, models, effort, modelRoles, newSession, sessions, login, logout, ...WWP_COMMANDS];