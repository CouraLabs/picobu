import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import type { Command } from "../types";
import { generateSessionId } from "../../../libs/sessions";
import { options } from "../../../libs/options";
import { loopStore } from "../../../stores/loop-store";
import { footerToastStore } from "../../../stores/footer-toast-store";

/**
 * Switch the working directory to `raw` (absolute, relative to the current
 * cwd, or `~/...`). Mutates the `options.app.cwd` singleton so every cwd
 * consumer (tools default to `process.chdir`'d process cwd; prompts read
 * `options.app.cwd`), moves the Node process itself, and mirrors the new
 * directory into the loop store so reactive UI (status bar, pickers) follows.
 * Returns null on success or a user-facing error message. On success the
 * caller must start a fresh session (`bindings.switchSession(generateSessionId())`)
 * so the loop, saver and UI all re-resolve against the new folder.
 */
export const changeDirectory = async (raw: string): Promise<string | null> => {
  let dir = raw.trim();
  if (!dir) return "cd: missing directory argument";
  if (dir.startsWith("~")) dir = join(options.app.homeDir, dir.slice(1));
  if (!dir.startsWith("/")) dir = resolve(options.app.cwd, dir);

  try {
    if (!(await stat(dir)).isDirectory()) return `cd: not a directory: ${raw}`;
  } catch {
    return `cd: no such directory: ${raw}`;
  }

  const target = resolve(dir);
  if (target === options.app.cwd) return null;

  options.app.cwd = target;
  process.chdir(target);
  loopStore.trigger.setCwd({ cwd: target });
  return null;
};

/**
 * `/cd` — change the working directory; with no args, open the directory picker.
 * A successful switch starts a fresh session: sessions are stored per folder
 * (`~/.picobu/sessions/<folder>/`), and every cwd consumer (system prompt,
 * git status, tools) re-resolves on the new session's mount. Requires idle:
 * switching cwd mid-run would silently move the ground out from under the
 * agent's tools.
 */
export const cd: Command = {
  kind: "system",
  name: "cd",
  aliases: [],
  flags: ["code"],
  requiresIdle: true,
  title: "cd",
  description: "Changes the working directory (starts a new session); no args opens a picker",
  path: "",
  handler: async (args, bindings) => {
    const dir = args.trim();
    if (!dir) {
      loopStore.trigger.openCwdPicker();
      return;
    }
    const error = await changeDirectory(dir);
    if (error) {
      footerToastStore.trigger.show({ message: error });
      return;
    }
    bindings.switchSession(generateSessionId());
  },
};
