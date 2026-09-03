#!/usr/bin/env bun
import { Command } from "commander";
import { folderKeyFor, listSessions } from "@harness/agent/factory/loop/session.ts";
import { options } from "@libs/options.ts";
import { autoloadLlmProviders } from "@harness/agent/factory/llm-providers/registry.ts";
import { ensureOAuthTokens } from "@auth/index.ts";
import { startCronScheduler } from "@cron/cron-store.ts";
import { connectToWhatsApp } from "@integrations/whatsapp/connection.ts";

const program = new Command();
program
  .name("picobu")
  .description("Headless autonomous coding agent core");

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

// Bootstrap runs after provider discovery so any env-gated custom provider is
// merged into options.json before credentials are refreshed. It also starts
// the long-lived background services: the cron scheduler (30s sweep) and, when
// enabled in options, the WhatsApp connection (reconnects from persisted
// credentials without a QR).
const bootstrap = async (): Promise<void> => {
  await autoloadLlmProviders();
  // Load auth.json + refresh expired OAuth tokens so synchronous model
  // resolution during a run can read valid access tokens.
  await ensureOAuthTokens();
  startCronScheduler();
  if (options.whatsapp.enabled) void connectToWhatsApp();
};

program.action(() => {
  void bootstrap().then(() => {
    console.log("picobu headless core ready (no UI attached).");
  });
});

program.parse(process.argv);
