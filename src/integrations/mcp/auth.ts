import { join } from 'node:path'
import { auth, type OAuthClientInformation, type OAuthClientMetadata, type OAuthClientProvider, type OAuthTokens } from '@ai-sdk/mcp'
import { options } from '@config/options.ts'
import type { McpServerOptions } from '@integrations/mcp/config.ts'
import { acquireLock } from '@shared/lock.ts'

const REFRESH_GRACE_MS = 5 * 60 * 1000

const CALLBACK_PORT = 19888
const CALLBACK_PATH = '/callback'
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000
export const MCP_REDIRECT_URL = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`

export interface McpAuthEntry {
  tokens?: OAuthTokens
  expiresAt?: number
  clientInformation?: OAuthClientInformation
}
export type McpAuthFile = Record<string, McpAuthEntry>
const DEFAULT_PATH = join(options.app.systemDir, 'mcp-auth.json')
let authFilePath = DEFAULT_PATH
let cache: McpAuthFile | null = null

export const initMcpAuthFilePath = (path: string): void => {
  authFilePath = path
  cache = null
}

export const resetMcpAuthCache = (): void => {
  cache = null
}

export const readMcpAuthFile = async (path: string): Promise<McpAuthFile> => {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return {}
    const parsed: unknown = await file.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as McpAuthFile
  } catch {
    return {}
  }
}

export const listMcpCredentials = (): McpAuthFile => cache ?? {}
export const getMcpCredential = (serverId: string): McpAuthEntry | undefined => listMcpCredentials()[serverId]

let persistChain: Promise<void> = Promise.resolve()
const persist = (mutate: (current: McpAuthFile) => McpAuthFile): Promise<void> => {
  const run = persistChain.then(async () => {
    const lock = await acquireLock(authFilePath)
    try {
      const current = await readMcpAuthFile(authFilePath)
      const updated = mutate(current)
      cache = updated
      await Bun.write(authFilePath, JSON.stringify(updated, null, 2))
    } finally {
      lock.release()
    }
  })
  persistChain = run.then(
    () => {},
    () => {},
  )
  return run
}

export const initMcpAuth = async (): Promise<void> => {
  if (cache === null) cache = await readMcpAuthFile(authFilePath)
}

export const setMcpCredential = async (serverId: string, entry: McpAuthEntry): Promise<void> => {
  await persist((current) => ({ ...current, [serverId]: entry }))
}

export const removeMcpCredential = async (serverId: string): Promise<boolean> => {
  let removed = false
  await persist((current) => {
    if (!current[serverId]) return current
    removed = true
    const { [serverId]: _removed, ...rest } = current
    return rest
  })
  return removed
}

export const isMcpAuthActive = (serverId: string, now = Date.now()): boolean => {
  const entry = getMcpCredential(serverId)
  if (!entry?.tokens?.access_token) return false
  return entry.expiresAt === undefined || entry.expiresAt - REFRESH_GRACE_MS > now
}

export const usesMcpAuth = (server: McpServerOptions): boolean => server.type !== 'stdio' && (server.auth === true || getMcpCredential(server.id)?.tokens?.access_token !== undefined)

const rootDomain = (host: string): string => host.toLowerCase().split('.').slice(-2).join('.')

const isLocalHost = (host: string): boolean => host === 'localhost' || host === '127.0.0.1' || host === '::1'

export const createMcpAuthProvider = (server: McpServerOptions): { provider: OAuthClientProvider; lastAuthorizationUrl: () => URL | undefined } => {
  const serverId = server.id
  const serverUrl = server.url
  if (!serverUrl) throw new Error(`MCP server "${serverId}" requires "url"`)
  let lastAuthorizationUrl: URL | undefined
  let verifier: string | undefined
  let state: string | undefined
  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return MCP_REDIRECT_URL
    },
    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: `picobu (${serverId})`,
        redirect_uris: [MCP_REDIRECT_URL],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }
    },
    async tokens() {
      return getMcpCredential(serverId)?.tokens
    },
    async saveTokens(tokens) {
      const existing = getMcpCredential(serverId)
      await setMcpCredential(serverId, {
        tokens,
        clientInformation: existing?.clientInformation,
        expiresAt: tokens.expires_in !== undefined ? Date.now() + tokens.expires_in * 1000 : undefined,
      })
    },
    async clientInformation() {
      return getMcpCredential(serverId)?.clientInformation
    },
    async saveClientInformation(clientInformation) {
      const existing = getMcpCredential(serverId)
      await setMcpCredential(serverId, {
        tokens: existing?.tokens,
        clientInformation,
        expiresAt: existing?.expiresAt,
      })
    },
    async redirectToAuthorization(authorizationUrl) {
      lastAuthorizationUrl = authorizationUrl
      console.log(`Open this URL in your browser to authorize MCP server "${serverId}":\n${authorizationUrl}`)
    },
    async saveCodeVerifier(codeVerifier) {
      verifier = codeVerifier
    },
    async codeVerifier() {
      if (!verifier) throw new Error(`No code verifier stored for MCP server "${serverId}"`)
      return verifier
    },
    state() {
      state = crypto.randomUUID()
      return state
    },
    saveState(saved) {
      state = saved
    },
    storedState() {
      return state
    },
    validateAuthorizationServerURL(_serverUrl, authorizationServerUrl) {
      const expected = new URL(serverUrl)
      const actual = new URL(authorizationServerUrl)
      if (actual.protocol !== 'https:' && !isLocalHost(actual.hostname)) {
        throw new Error(`MCP server "${serverId}" advertised an insecure OAuth authorization server: ${actual.origin} (https required)`)
      }
      if (actual.origin === expected.origin) return
      if (rootDomain(actual.hostname) === rootDomain(expected.hostname) && actual.hostname.includes('.')) return
      throw new Error(`MCP server "${serverId}" advertised an unexpected OAuth authorization server: ${actual.origin} (expected ${expected.origin})`)
    },
  }
  return { provider, lastAuthorizationUrl: () => lastAuthorizationUrl }
}

interface CallbackResult {
  code: string
  state?: string
  issuer?: string
}

export const startMcpLogin = async (server: McpServerOptions): Promise<void> => {
  if (server.type === 'stdio') {
    throw new Error(`MCP server "${server.id}" is a local stdio server — no OAuth login needed`)
  }
  await initMcpAuth()
  const serverUrl = server.url
  if (!serverUrl) throw new Error(`MCP server "${server.id}" requires "url"`)
  const { provider, lastAuthorizationUrl } = createMcpAuthProvider(server)
  const first = await auth(provider, { serverUrl })
  if (first === 'AUTHORIZED') {
    console.log(`MCP server "${server.id}" is already logged in.`)
    return
  }
  const authorizationUrl = lastAuthorizationUrl()
  if (!authorizationUrl) throw new Error(`MCP login for "${server.id}" produced no authorization URL`)
  const callbackServer = startMcpCallbackServer()
  console.log(`Waiting for the OAuth redirect on ${callbackServer.url} ...`)
  let callback: CallbackResult
  try {
    callback = await callbackServer.result
  } finally {
    callbackServer.stop()
  }
  const second = await auth(provider, {
    serverUrl,
    authorizationCode: callback.code,
    callbackState: callback.state,
    callbackIssuer: callback.issuer,
  })
  if (second !== 'AUTHORIZED') {
    throw new Error(`MCP login for "${server.id}" did not complete (flow returned "${second}")`)
  }
  console.log(`Logged in to MCP server "${server.id}" — tokens stored in ${authFilePath}`)
}

export const ensureMcpAuth = async (server: McpServerOptions): Promise<void> => {
  if (server.type === 'stdio') return
  await initMcpAuth()
  if (!usesMcpAuth(server)) return
  if (isMcpAuthActive(server.id)) return
  const serverUrl = server.url
  if (!serverUrl) throw new Error(`MCP server "${server.id}" requires "url"`)
  const { provider } = createMcpAuthProvider(server)
  const result = await auth(provider, { serverUrl })
  if (result !== 'AUTHORIZED') {
    throw new Error(`MCP server "${server.id}" requires login — run \`picobu mcp login ${server.id}\``)
  }
}

export interface McpCallbackServer {
  url: string
  port: number
  result: Promise<CallbackResult>
  stop: (force?: boolean) => void
}

type CallbackOutcome = { ok: true; value: CallbackResult } | { ok: false; error: Error }

export const startMcpCallbackServer = (config: { port?: number; path?: string; timeoutMs?: number } = {}): McpCallbackServer => {
  const port = config.port ?? CALLBACK_PORT
  const path = config.path ?? CALLBACK_PATH
  const timeoutMs = config.timeoutMs ?? CALLBACK_TIMEOUT_MS
  let settle: ((outcome: CallbackOutcome) => void) | undefined
  const result = new Promise<CallbackResult>((resolve, reject) => {
    settle = (outcome) => (outcome.ok ? resolve(outcome.value) : reject(outcome.error))
  })
  let done = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const finish = (outcome: CallbackOutcome): void => {
    if (done) return
    done = true
    if (timeout) clearTimeout(timeout)
    settle?.(outcome)
  }
  let server: ReturnType<typeof Bun.serve>
  try {
    server = Bun.serve({
      port,
      fetch(request) {
        const incoming = new URL(request.url)
        if (incoming.pathname !== path) return new Response('Not found', { status: 404 })
        const error = incoming.searchParams.get('error')
        if (error) {
          finish({ ok: false, error: new Error(`OAuth redirect reported an error: ${error} (${incoming.searchParams.get('error_description') ?? 'no detail'})`) })
          return new Response('picobu: MCP login failed — see the terminal.', { status: 400 })
        }
        const code = incoming.searchParams.get('code')
        if (!code) {
          finish({ ok: false, error: new Error('OAuth redirect carried no authorization code') })
          return new Response('picobu: MCP login failed — see the terminal.', { status: 400 })
        }
        finish({
          ok: true,
          value: {
            code,
            state: incoming.searchParams.get('state') ?? undefined,
            issuer: incoming.searchParams.get('iss') ?? undefined,
          },
        })
        return new Response('picobu: MCP login complete — you can close this tab.', { status: 200 })
      },
      error() {
        return new Response('error', { status: 500 })
      },
    })
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`Failed to start the MCP OAuth callback server on port ${port}: ${detail}`)
  }
  const actualPort = server.port ?? port
  const url = `http://localhost:${actualPort}${path}`
  timeout = setTimeout(() => {
    server.stop(true)
    finish({ ok: false, error: new Error(`Timed out waiting for the OAuth redirect on ${url}`) })
  }, timeoutMs)
  const stop = (force = false): void => {
    if (timeout) clearTimeout(timeout)
    done = true
    server.stop(force)
  }
  return { url, port: actualPort, result, stop }
}
