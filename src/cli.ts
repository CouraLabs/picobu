#!/usr/bin/env bun
import { autoloadLlmProviders } from "@agent/model/registry.ts";
import { SessionManager } from "@agent/sessions/session-manager.ts";
import { folderKeyFor } from "@agent/sessions/session-paths.ts";
import { ensureOAuthTokens, listOAuthProviders, startLogin } from "@auth/index.ts";
import { logoutOAuthProvider } from "@auth/register.ts";
import { options } from "@config/options.ts";
import { removeMcpCredential, startMcpLogin } from "@integrations/mcp/auth.ts";
import { getMcpServer } from "@integrations/mcp/discover.ts";
import { listMcpServers } from "@integrations/mcp/status.ts";
import { connectToWhatsApp } from "@integrations/whatsapp/connection.ts";
import { Command } from "commander";

const program = new Command();
program.name("picobu").description("Headless autonomous coding agent core").option("--session [id]", "open the TUI, optionally resuming a session");
const sessions = program
  .command("sessions")
  .description("list saved sessions for a folder (title + lifecycle state)")
  .option("--dir <path>", "list another worktree's sessions")
  .action((opts: { dir?: string }) => {
    void (async () => {
      try {
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
      } catch (error) {
        console.error(`List failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
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
      try {
        const manager = new SessionManager();
        const tree = await manager.listSessionTree();
        if (tree.length === 0) {
          console.log("No sessions for this folder.");
          process.exit(0);
        }
        const label = (m: { id: string; title?: string; state: string }): string => `${m.id}  [${m.state}]  "${m.title ?? "(untitled)"}"`;
        for (const root of tree) {
          console.log(label(root));
          for (const child of root.children) console.log(`  └─ ${label(child)}`);
        }
      } catch (error) {
        console.error(`Tree failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
      process.exit(0);
    })();
  });

const mcp = program.command("mcp").description("list configured MCP servers with connection and auth status");
mcp.action(() => {
  void (async () => {
    try {
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
    } catch (error) {
      console.error(`MCP list failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
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

const bootstrap = async (): Promise<void> => {
  await autoloadLlmProviders();

  await ensureOAuthTokens();
  if (options.whatsapp.enabled) {
    connectToWhatsApp().catch((error) => {
      console.error(`WhatsApp connect failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
};
program
  .command("login")
  .description("log in to an OAuth provider (openai, anthropic, github-copilot) — no args lists status")
  .argument("[provider]", "OAuth provider id")
  .argument("[opts]", "provider options (e.g. enterprise domain for Copilot)")
  .action((provider?: string, opts?: string) => {
    void (async () => {
      try {
        if (!provider) {
          for (const row of listOAuthProviders()) {
            console.log(`${row.id}  ${row.name}  ${row.loggedIn ? "logged in" : "logged out"}`);
          }
          process.exit(0);
        }
        await startLogin(provider, opts);
      } catch (error) {
        console.error(`Login failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
      process.exit(0);
    })();
  });
program
  .command("logout")
  .description("log out of an OAuth provider and repoint harness selectors")
  .argument("<provider>", "OAuth provider id")
  .action((provider: string) => {
    void (async () => {
      try {
        const current = options.harness.defaultModel ?? "";
        const result = await logoutOAuthProvider(provider, current);
        console.log(result.removed ? `Logged out of "${provider}".` : `No stored credential for "${provider}".`);
      } catch (error) {
        console.error(`Logout failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
      process.exit(0);
    })();
  });
program.action((opts: { session?: string | boolean }) => {
  void (async () => {
    if (opts.session !== undefined) {
      await bootstrap();
      const { runTui } = await import("@tui/init.tsx");
      await runTui({ sessionId: typeof opts.session === "string" ? opts.session : undefined });
      return;
    }
    await bootstrap().then(() => {
      console.log("picobu headless core ready (no UI attached).");
    });
  })();
});
program.parse(process.argv);
