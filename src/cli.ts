#!/usr/bin/env bun
import { Command } from "commander";
import { existsSync } from "node:fs";
import { folderKeyFor, listSessions, sessionFilePath } from "./libs/sessions";
import { options } from "./libs/options";
import { autoloadLlmProviders } from "./harness/agent/factory/llm-providers/registry";
import { ensureOAuthTokens } from "./auth";

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
  }
  void bootstrap(opts);
});

// The entry module loads after provider discovery: the global stores resolve
// their default model at import time, so any env-gated custom provider must
// already be merged into options.json by then.
const bootstrap = async (opts: { web?: boolean; session?: string }): Promise<void> => {
  await autoloadLlmProviders();
  // Load auth.json + refresh expired OAuth tokens so synchronous model
  // resolution during the run can read valid access tokens.
  await ensureOAuthTokens();
  if (opts.session !== undefined) {
    const { startTui } = await import("./tui");
    await startTui({ sessionId: opts.session });
    return;
  }
  if (opts.web) {
    const { startServer } = await import("./server");
    startServer();
    return;
  }
  const { startTui } = await import("./tui");
  await startTui({});
};

program.parse(process.argv);
