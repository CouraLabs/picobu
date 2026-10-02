#!/usr/bin/env bun
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { autoloadLlmProviders } from '@agent/model/registry.ts'
import { ALL_PROMPT_FILES, overwritePromptFiles } from '@agent/prompts/prompt-files.ts'
import { SessionManager } from '@agent/sessions/session-manager.ts'
import { folderKeyFor } from '@agent/sessions/session-paths.ts'
import { WORKFLOW_PROMPT_FILES } from '@agent/workflows/builtin.ts'
import { removeLegacyLlmAuthFile } from '@config/legacy-auth-cleanup.ts'
import { options } from '@config/options.ts'
import { removeMcpCredential, startMcpLogin } from '@integrations/mcp/auth.ts'
import { getMcpServer } from '@integrations/mcp/discover.ts'
import { listMcpServers } from '@integrations/mcp/status.ts'
import { setConsoleTitle } from '@shared/console-title.ts'
import { initLogger, logError } from '@shared/logger.ts'
import { getVersion } from '@shared/version.ts'
import { withTimeout } from '@shared/with-timeout.ts'
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
  .option('--off-load', 'overwrite the bundled agent/subagent/workflow prompt markdowns under ~/.picobu, then exit')
program.addHelpText(
  'after',
  () => `

Supported providers:
  API-key autoload (from the @opencode-ai/models catalog when env vars are set):
    HYPER_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, plus every
    models.dev provider with \`env\` (e.g. GOOGLE/GEMINI, XAI, MISTRAL, GROQ,
    DEEPSEEK, OPENROUTER, CEREBRAS, COHERE, TOGETHER, PERPLEXITY, AZURE,
    AWS/Bedrock, Vertex, Cloudflare, DigitalOcean, Snowflake, Modal, GitLab).
    The provider \`npm\` field selects the @ai-sdk factory used at runtime.

  Local and compatible endpoints (autoloaded when reachable; env overrides optional):
    LiteLLM    LITELLM_BASE_URL   (default http://localhost:4000/v1)   LITELLM_API_KEY  (optional)
    Ollama     OLLAMA_BASE_URL    (default http://localhost:11434/v1)  OLLAMA_API_KEY   (optional)
    LM Studio  LMSTUDIO_BASE_URL  (default http://localhost:1234/v1)   LMSTUDIO_API_KEY (optional)
    Models are read from <baseUrl>/models; API keys are optional for keyless endpoints.
    Custom endpoints go in options.json with type \`openai-compatible\`, \`anthropic\`
    or \`openai-responses\` (aliases: \`anthropic-compatible\`, \`openai-responses-compatible\`).`,
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
  .description('run the OAuth login flow for an MCP server')
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

const PROVIDER_BOOTSTRAP_TIMEOUT_MS = 15000
const bootstrapProviders = async (): Promise<void> => {
  removeLegacyLlmAuthFile()
  try {
    await withTimeout(autoloadLlmProviders(), PROVIDER_BOOTSTRAP_TIMEOUT_MS, 'provider bootstrap')
  } catch (error) {
    logError(error, { scope: 'provider-bootstrap' })
  }
}
program
  .command('update')
  .description('Update picobu to the latest published version, then reopen the last session')
  .action(() => {
    void (async () => {
      const { runForegroundUpdate } = await import('@shared/update.ts')
      const { lastSessionLaunchPlan } = await import('@agent/sessions/last-session.ts')
      await runForegroundUpdate(lastSessionLaunchPlan())
    })()
  })
interface CliActionOptions {
  server?: boolean
  session?: string | boolean
  cd?: string
  clearPromptsHistory?: boolean
  offLoad?: boolean
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
    if (opts.offLoad) {
      const { createInterface } = await import('node:readline/promises')
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      const dir = options.app.systemDir
      console.log(`This will overwrite the prompt markdowns under ${dir} (agents/ and workflows/).`)
      const answer = (await rl.question('Proceed? [y/N] ')).trim().toLowerCase()
      rl.close()
      if (answer !== 'y') {
        console.log('Aborted. No files were changed.')
        process.exit(0)
      }
      const written = overwritePromptFiles([...ALL_PROMPT_FILES, ...Object.values(WORKFLOW_PROMPT_FILES)])
      for (const file of written) console.log(`wrote ${file}`)
      console.log(`Off-loaded ${written.length} prompt file(s) to ${dir}.`)
      process.exit(0)
    }
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
      await bootstrapProviders()
      setConsoleTitle(options.app.name)
      console.log('picobu headless server ready (no UI attached). Run without flags to open the TUI.')
      const keepAlive = setInterval(() => {}, 60_000)
      await new Promise<void>((resolve) => {
        const shutdown = (): void => {
          clearInterval(keepAlive)
          resolve()
        }
        process.once('SIGINT', shutdown)
        process.once('SIGTERM', shutdown)
      })
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
      const { runTui } = await import('@tui/init.tsx')
      await runTui({ sessionId: typeof opts.session === 'string' ? opts.session : undefined })
    } catch (error) {
      logError(error, { scope: 'tui' })
      console.error(`picobu: TUI error: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`picobu: see ${options.app.systemDir}/logs for details`)
      process.exit(1)
    }
  })()
})
program.parse(process.argv)
