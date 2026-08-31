import type { Command } from "../types";
import { effort } from "./effort";
import { models } from "./models";
import { newSession } from "./new";
import { quit } from "./quit";
import { sessions } from "./sessions";

/** Built-in system commands, ordered by first-found precedence. */
export const SYSTEM_COMMANDS: Command[] = [quit, models, effort, newSession, sessions];