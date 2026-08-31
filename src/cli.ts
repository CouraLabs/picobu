#!/usr/bin/env bun
import { Command } from "commander";
import { existsSync } from "node:fs";
import { startServer } from "./server";
import { startTui } from "./tui";
import { folderKeyFor, listSessions, sessionFilePath } from "./libs/sessions";
import { options } from "./libs/options";

const program = new Command();
program
  .name("picobu")
  .description("Autonomous coding agent for your terminal")
  .option("--web", "run the web (browser) variant")
  .option("--session <id>", "resume the session with the given id");

program
  .command("sessions")
  .description("list saved sessions for the current folder")
  .action(() => {
    void (async () => {
      const rows = await listSessions(folderKeyFor(options.app.cwd));
      if (rows.length === 0) {
        console.log("No sessions for this folder.");
        process.exit(0);
      }
      console.log(`Sessions in ~/.picobu/sessions/${folderKeyFor(options.app.cwd)}`);
      for (const s of rows) console.log(`${s.id}  ${new Date(s.mtimeMs).toISOString()}  "${s.firstPrompt}"`);
      process.exit(0);
    })();
  });

// Top-level action routes the non-subcommand invocations (bare `picobu`,
// `--web`, `--session`). Commander 15 exits with help when a program that has
// subcommands is invoked without one and has no action handler, so the routing
// lives here.
program.action(() => {
  const opts = program.opts<{ web?: boolean; session?: string }>();
  if (opts.web && opts.session) {
    console.error("error: --web and --session cannot be combined");
    process.exit(1);
  }
  if (opts.session !== undefined) {
    if (!/^[0-9a-f]{16}$/.test(opts.session)) {
      console.error(`error: invalid session id "${opts.session}"`);
      process.exit(1);
    }
    const file = sessionFilePath(folderKeyFor(options.app.cwd), opts.session);
    if (!existsSync(file)) {
      console.error(`error: session "${opts.session}" not found for this folder.`);
      process.exit(1); // spec: discard, do NOT open the app
    }
    void startTui({ sessionId: opts.session });
    return;
  }
  if (opts.web) {
    startServer();
    return;
  }
  void startTui({});
});

program.parse(process.argv);
