#!/usr/bin/env bun
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { autoloadLlmProviders } from '@agent/model/registry.ts'
import { SessionManager } from '@agent/sessions/session-manager.ts'
import { folderKeyFor } from '@agent/sessions/session-paths.ts'
import { ensureOAuthTokens, listOAuthProviders, oauthAuthById, startLogin } from '@auth/index.ts'
import { logoutOAuthProvider, registerOAuthProvider } from '@auth/register.ts'
import { getCredential, initAuth } from '@auth/store.ts'
import { confirmReLogin, verifyOAuthCredential } from '@auth/verify.ts'
import { options } from '@config/options.ts'
import { removeMcpCredential, startMcpLogin } from '@integrations/mcp/auth.ts'
import { getMcpServer } from '@integrations/mcp/discover.ts'
import { listMcpServers } from '@integrations/mcp/status.ts'
import { connectToWhatsApp, disconnectFromWhatsApp } from '@integrations/whatsapp/connection.ts'
import { setConsoleTitle } from '@shared/console-title.ts'
import { initLogger, logError } from '@shared/logger.ts'
import { getVersion } from '@shared/version.ts'
import { Command } from 'commander'

const program = new Command()
program
  .name('picobu')
  .description('Picobu coding agent (TUI by default, --server for the headless daemon)')
  .version(getVersion())
  .option('--server', 'start the headless server (no UI)')
  .option('--session [id]', 'open the TUI resuming a session')
  .option('--cd <folder>', 'open the TUI with <folder> as cwd/workspace')
  .option('--clear-prompts-history', 'clear all prompt history and drafts, then exit')
program.addHelpText(
  'after',
  () => `

Supported providers:
  OAuth login (\`picobu login <provider-id>\`, details in \`picobu login --help\`):
    openai, anthropic, github-copilot, xai, openrouter, kimi-coding, digitalocean, snowflake-cortex, azure
  API-key autoload (from the @opencode-ai/models catalog when env vars are set):
    HYPER_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GITHUB_TOKEN, plus every
    models.dev provider with \`env\` (e.g. GOOGLE/GEMINI, XAI, MISTRAL, GROQ,
    DEEPSEEK, OPENROUTER, CEREBRAS, COHERE, TOGETHER, PERPLEXITY, AZURE,
    AWS/Bedrock, Vertex, Cloudflare, DigitalOcean, Snowflake, Modal, GitLab).
    The provider \`npm\` field selects the @ai-sdk factory used at runtime.`,
)
const sessions = program
  .command('sessions')
  .description('list saved sessions for a folder (title + lifecycle state)')
  .option('--dir <path>', "list another worktree's sessions")
  .action((opts: { dir?: string }) => {
    void (async () => {
      try {
        const cwd = opts.dir ? opts.dir : options.app.cwd
        const manager = new SessionManager({ cwd })
        const rows = await manager.listSessions()
        if (rows.length === 0) {
          console.log('No sessions for this folder.')
          process.exit(0)
        }
        console.log(`Sessions in ~/.picobu/sessions/${folderKeyFor(cwd)}`)
        for (const s of rows) {
          console.log(`${s.id}  ${new Date(s.mtimeMs).toISOString()}  [${s.state}]  "${s.title ?? s.firstPrompt}"${s.parentSessionId ? `  (sub of ${s.parentSessionId})` : ''}`)
        }
      } catch (error) {
        console.error(`List failed: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
      process.exit(0)
    })()
  })
sessions
  .command('delete')
  .description('delete a session and cascade to its sub sessions (refuses running subtrees)')
  .argument('<sessionId>', 'session id')
  .action((sessionId: string) => {
    void (async () => {
      const manager = new SessionManager()
      try {
        const deleted = await manager.deleteSession(sessionId)
        const subs = deleted - 1
        console.log(`Deleted ${deleted} session(s) (${subs} sub session(s)).`)
      } catch (error) {
        console.error(`Delete failed: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
      process.exit(0)
    })()
  })
sessions
  .command('rename')
  .description('rename a session (title only — the id is immutable)')
  .argument('<sessionId>', 'session id')
  .argument('<title>', 'new title')
  .action((sessionId: string, title: string) => {
    void (async () => {
      const manager = new SessionManager()
      try {
        await manager.renameSession(sessionId, title)
        console.log(`Renamed session ${sessionId} to "${title}".`)
      } catch (error) {
        console.error(`Rename failed: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
      process.exit(0)
    })()
  })
sessions
  .command('tree')
  .description('show the session tree (roots with their sub sessions)')
  .action(() => {
    void (async () => {
      try {
        const manager = new SessionManager()
        const tree = await manager.listSessionTree()
        if (tree.length === 0) {
          console.log('No sessions for this folder.')
          process.exit(0)
        }
        const label = (m: { id: string; title?: string; state: string }): string => `${m.id}  [${m.state}]  "${m.title ?? '(untitled)'}"`
        for (const root of tree) {
          console.log(label(root))
          for (const child of root.children) console.log(`  └─ ${label(child)}`)
        }
      } catch (error) {
        console.error(`Tree failed: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
      process.exit(0)
    })()
  })

const mcp = program.command('mcp').description('list configured MCP servers with connection and auth status')
mcp.action(() => {
  void (async () => {
    try {
      const rows = await listMcpServers()
      if (rows.length === 0) {
        console.log('No MCP servers configured (mcp block in ~/.picobu/options.json or ./.mcp.json).')
        process.exit(0)
      }
      for (const row of rows) {
        const auth = row.authRequired ? (row.authActive ? 'auth: active' : 'auth: login needed') : 'auth: none'
        console.log(`${row.id}  ${row.type}  ${row.target}  [${row.source}]  ${row.connected ? 'connected' : 'disconnected'}  ${auth}${row.error ? `  error: ${row.error}` : ''}`)
      }
    } catch (error) {
      console.error(`MCP list failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
    process.exit(0)
  })()
})
mcp
  .command('login')
  .description('run the OAuth login flow for an MCP server (auth: true in config)')
  .argument('<serverId>', 'configured MCP server id')
  .action((serverId: string) => {
    void (async () => {
      try {
        const server = await getMcpServer(serverId)
        if (!server) throw new Error(`Unknown MCP server "${serverId}" — configure it first`)
        await startMcpLogin(server)
      } catch (error) {
        console.error(`MCP login failed: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
      process.exit(0)
    })()
  })
mcp
  .command('logout')
  .description('remove the stored OAuth tokens for an MCP server')
  .argument('<serverId>', 'configured MCP server id')
  .action((serverId: string) => {
    void (async () => {
      const removed = await removeMcpCredential(serverId)
      console.log(removed ? `Logged out of MCP server "${serverId}".` : `No stored tokens for "${serverId}".`)
      process.exit(0)
    })()
  })

const bootstrap = async (): Promise<void> => {
  await autoloadLlmProviders()

  await ensureOAuthTokens()
  if (options.whatsapp.enabled) {
    connectToWhatsApp().catch((error) => {
      console.error(`WhatsApp connect failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
}
const loginCommand = program
  .command('login')
  .description('log in to an OAuth provider — no args lists status')
  .argument('[provider]', 'OAuth provider id (see `picobu login --help` for the list)')
  .argument('[opts]', 'provider options (e.g. enterprise domain for Copilot, `headless` for OpenAI device flow, `<account> [role]` for Snowflake, `<resource-name>` for Azure)')
  .option('-f, --force', 'skip the already-logged-in check and log in again')
loginCommand.addHelpText(
  'after',
  () => `

Supported providers (use with \`picobu login <provider-id>\`):
  openai            OpenAI (browser OAuth, or \`picobu login openai headless\` for device flow)
  anthropic         Anthropic (browser OAuth, Claude Pro/Max)
  github-copilot    GitHub Copilot (device-code flow, opts = enterprise domain)
  xai               xAI (device-code flow, SuperGrok subscription)
  openrouter        OpenRouter (browser OAuth, exchanges code for API key)
  kimi-coding       Kimi Coding (device-code flow, subscription)
  digitalocean      DigitalOcean (browser OAuth, inference routers)
  snowflake-cortex  Snowflake Cortex (browser OAuth, \`picobu login snowflake-cortex <account> [role]\`)
  azure             Azure (Microsoft Entra ID via \`az login\`, \`picobu login azure <resource-name>\`)

Aliases: copilot → github-copilot, claude → anthropic, chatgpt/codex → openai, kimi → kimi-coding, snowflake → snowflake-cortex, do → digitalocean.

API-key providers (no login needed) autoload from the @opencode-ai/models catalog when their env vars are set. See \`picobu --help\` for the full list.`,
)
loginCommand.action((provider?: string, loginOpts?: string, cmdOpts?: { force?: boolean }) => {
  void (async () => {
    try {
      if (!provider) {
        for (const row of listOAuthProviders()) {
          console.log(`${row.id}  ${row.name}  ${row.loggedIn ? 'logged in' : 'logged out'}`)
        }
        process.exit(0)
      }
      if (!cmdOpts?.force) {
        await initAuth()
        const auth = oauthAuthById(provider)
        const existing = auth ? getCredential(auth.id) : undefined
        if (auth && existing) {
          const result = await verifyOAuthCredential(auth, existing)
          if (result.ok) {
            console.log(`${auth.name} is already logged in and working (models catalog: ${result.modelCount} models).`)
            try {
              await registerOAuthProvider(auth, result.credential)
            } catch (error) {
              console.warn(`Could not sync ${auth.name} models into options (${error instanceof Error ? error.message : String(error)}) — the model list may be stale…`)
            }
            const again = await confirmReLogin(auth.name)
            if (!again) {
              console.log(`Keeping the existing ${auth.name} login.`)
              process.exit(0)
            }
          } else {
            console.warn(`Stored login for ${auth.name} seems invalid (${result.error}) — starting a fresh login…`)
          }
        }
      }
      await startLogin(provider, loginOpts)
    } catch (error) {
      console.error(`Login failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
    process.exit(0)
  })()
})
program
  .command('logout')
  .description('log out of an OAuth provider and repoint harness selectors')
  .argument('<provider>', 'OAuth provider id')
  .action((provider: string) => {
    void (async () => {
      try {
        const current = options.harness.defaultModel ?? ''
        const result = await logoutOAuthProvider(provider, current)
        console.log(result.removed ? `Logged out of "${provider}".` : `No stored credential for "${provider}".`)
      } catch (error) {
        console.error(`Logout failed: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
      process.exit(0)
    })()
  })
interface CliActionOptions {
  server?: boolean
  session?: string | boolean
  cd?: string
  clearPromptsHistory?: boolean
}
const resolveWorkspace = async (folder: string): Promise<string> => {
  const next = resolve(folder)
  const info = await stat(next).catch(() => undefined)
  if (!info?.isDirectory()) throw new Error(`Not a directory: ${folder}`)
  return next
}
const openWorkspace = async (folder: string): Promise<void> => {
  const next = await resolveWorkspace(folder)
  process.chdir(next)
  options.app.cwd = next
}
program.action((opts: CliActionOptions) => {
  void (async () => {
    initLogger({ runId: typeof opts.session === 'string' && opts.session ? opts.session : `pid-${process.pid}`, systemDir: options.app.systemDir })
    if (opts.clearPromptsHistory) {
      const { clearPromptHistory } = await import('@agent/sessions/prompt-history.ts')
      const cleared = clearPromptHistory()
      console.log(`Cleared prompt history (${cleared.history} prompt(s), ${cleared.drafts} draft(s)).`)
      process.exit(0)
    }
    if (opts.server) {
      if (opts.session !== undefined || opts.cd !== undefined) {
        console.error('Cannot combine --server with --session or --cd.')
        process.exit(1)
      }
      try {
        await bootstrap()
      } catch (error) {
        logError(error, { scope: 'bootstrap-server' })
        console.error(`Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
      setConsoleTitle(undefined)
      if (!options.whatsapp.enabled) {
        console.log('picobu headless server ready (no UI attached). WhatsApp disabled — run without flags to open the TUI.')
        return
      }
      console.log('picobu headless server ready (no UI attached). WhatsApp daemon running — run without flags to open the TUI.')
      const shutdown = (): void => {
        disconnectFromWhatsApp()
        process.exit(0)
      }
      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
      return
    }
    if (opts.cd !== undefined) {
      try {
        await openWorkspace(opts.cd)
      } catch (error) {
        logError(error, { scope: 'open-workspace' })
        console.error(`Invalid --cd: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
    }
    try {
      await bootstrap()
    } catch (error) {
      logError(error, { scope: 'bootstrap-tui' })
      console.error(`Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
    const { runTui } = await import('@tui/init.tsx')
    await runTui({ sessionId: typeof opts.session === 'string' ? opts.session : undefined })
  })()
})
program.parse(process.argv)
