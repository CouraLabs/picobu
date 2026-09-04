#!/usr/bin/env bun
import { Command } from "commander";
import { folderKeyFor } from "@agent/sessions/session.ts";
import { SessionManager } from "@agent/sessions/session-manager.ts";
import { options } from "@config/options.ts";
import { autoloadLlmProviders } from "@agent/model/registry.ts";
import { ensureOAuthTokens } from "@auth/index.ts";
import { connectToWhatsApp } from "@integrations/whatsapp/connection.ts";
import { getMcpServer } from "@integrations/mcp/discover.ts";
import { startMcpLogin, removeMcpCredential } from "@integrations/mcp/auth.ts";
import { listMcpServers } from "@integrations/mcp/status.ts";

const program = new Command();
program
  .name("picobu")
  .description("Headless autonomous coding agent core");

const sessions = program
  .command("sessions")
  .description("list saved sessions for a folder (title + lifecycle state)")
  .option("--dir <path>", "list another worktree's sessions")
  .action((opts: { dir?: string }) => {
    void (async () => {
      const cwd = opts.dir ? opts.dir : options.app.cwd;
      const manager = new SessionManager({ cwd });
      const rows = await manager.listSessions();
      if (rows.length === 0) {
        console.log("No sessions for this folder.");
        process.exit(0);
      }
      console.log(`Sessions in ~/.picobu/sessions/${folderKeyFor(cwd)}`);
      for (const s of rows) {
        console.log(
          `${s.id}  ${new Date(s.mtimeMs).toISOString()}  [${s.state}]  "${s.title ?? s.firstPrompt}"${s.parentSessionId ? `  (sub of ${s.parentSessionId})` : ""}`,
        );
      }
      process.exit(0);
    })();
  });

sessions
  .command("delete")
  .description("delete a session and cascade to its sub sessions (refuses running subtrees)")
  .argument("<sessionId>", "session id")
  .action((sessionId: string) => {
    void (async () => {
      const manager = new SessionManager();
      try {
        const deleted = await manager.deleteSession(sessionId);
        const subs = deleted - 1;
        console.log(`Deleted ${deleted} session(s) (${subs} sub session(s)).`);
      } catch (error) {
        console.error(`Delete failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
      process.exit(0);
    })();
  });

sessions
  .command("rename")
  .description("rename a session (title only — the id is immutable)")
  .argument("<sessionId>", "session id")
  .argument("<title>", "new title")
  .action((sessionId: string, title: string) => {
    void (async () => {
      const manager = new SessionManager();
      try {
        await manager.renameSession(sessionId, title);
        console.log(`Renamed session ${sessionId} to "${title}".`);
      } catch (error) {
        console.error(`Rename failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
      process.exit(0);
    })();
  });

sessions
  .command("tree")
  .description("show the session tree (roots with their sub sessions)")
  .action(() => {
    void (async () => {
      const manager = new SessionManager();
      const tree = await manager.listSessionTree();
      if (tree.length === 0) {
        console.log("No sessions for this folder.");
        process.exit(0);
      }
      const label = (m: { id: string; title?: string; state: string }): string =>
        `${m.id}  [${m.state}]  "${m.title ?? "(untitled)"}"`;
      for (const root of tree) {
        console.log(label(root));
        for (const child of root.children) console.log(`  └─ ${label(child)}`);
      }
      process.exit(0);
    })();
  });

// MCP server management: status table + OAuth login/logout.
const mcp = program
  .command("mcp")
  .description("list configured MCP servers with connection and auth status");

mcp
  .action(() => {
    void (async () => {
      const rows = await listMcpServers();
      if (rows.length === 0) {
        console.log("No MCP servers configured (mcp block in ~/.picobu/options.json or ./.mcp.json).");
        process.exit(0);
      }
      for (const row of rows) {
        const auth = row.authRequired ? (row.authActive ? "auth: active" : "auth: login needed") : "auth: none";
        console.log(
          `${row.id}  ${row.type}  ${row.target}  [${row.source}]  ${row.connected ? "connected" : "disconnected"}  ${auth}${row.error ? `  error: ${row.error}` : ""}`,
        );
      }
      process.exit(0);
    })();
  });

mcp
  .command("login")
  .description("run the OAuth login flow for an MCP server (auth: true in config)")
  .argument("<serverId>", "configured MCP server id")
  .action((serverId: string) => {
    void (async () => {
      try {
        const server = await getMcpServer(serverId);
        if (!server) throw new Error(`Unknown MCP server "${serverId}" — configure it first`);
        await startMcpLogin(server);
      } catch (error) {
        console.error(`MCP login failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
      process.exit(0);
    })();
  });

mcp
  .command("logout")
  .description("remove the stored OAuth tokens for an MCP server")
  .argument("<serverId>", "configured MCP server id")
  .action((serverId: string) => {
    void (async () => {
      const removed = await removeMcpCredential(serverId);
      console.log(removed ? `Logged out of MCP server "${serverId}".` : `No stored tokens for "${serverId}".`);
      process.exit(0);
    })();
  });

// Bootstrap runs after provider discovery so any env-gated custom provider is
// merged into options.json before credentials are refreshed. It also starts
// the long-lived background service: the WhatsApp connection (reconnects from
// persisted credentials without a QR), when enabled in options.
const bootstrap = async (): Promise<void> => {
  await autoloadLlmProviders();
  // Load auth.json + refresh expired OAuth tokens so synchronous model
  // resolution during a run can read valid access tokens.
  await ensureOAuthTokens();
  if (options.whatsapp.enabled) void connectToWhatsApp();
};

program.action(() => {
  void bootstrap().then(() => {
    console.log("picobu headless core ready (no UI attached).");
  });
});

program.parse(process.argv);
