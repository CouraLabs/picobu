import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { LoopMessage, LoopStats } from '@agent/loop/create-loop.ts'
import { folderKeyFor, sessionDir } from '@agent/sessions/session-paths.ts'
import { options } from '@config/options.ts'

export interface ExportSessionInput {
  sessionId: string
  cwd?: string
  messages?: Array<LoopMessage>
  stats?: LoopStats
  title?: string
  out?: string
}

const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const textOf = (message: LoopMessage): string =>
  (message.parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => (p as { type?: unknown }).type === 'text')
    .map((p) => p.text)
    .join('\n')

const toolRowsOf = (message: LoopMessage): Array<{ name: string; input: string; output: string }> => {
  const rows: Array<{ name: string; input: string; output: string }> = []
  for (const raw of message.parts ?? []) {
    const part = raw as { type?: unknown; toolName?: unknown; input?: unknown; output?: unknown; errorText?: unknown }
    const type = typeof part.type === 'string' ? part.type : ''
    const name = type === 'dynamic-tool' && typeof part.toolName === 'string' ? part.toolName : type.startsWith('tool-') ? type.slice('tool-'.length) : undefined
    if (!name) continue
    const input = (() => {
      try {
        return JSON.stringify(part.input ?? null).slice(0, 2000)
      } catch {
        return String(part.input ?? '')
      }
    })()
    const output = (() => {
      const value = part.output ?? part.errorText ?? ''
      try {
        const text = typeof value === 'string' ? value : JSON.stringify(value)
        return text.slice(0, 8000)
      } catch {
        return String(value)
      }
    })()
    rows.push({ name, input, output })
  }
  return rows
}

const readJsonFile = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

export const renderSessionHtml = (input: { sessionId: string; title?: string; messages: Array<LoopMessage>; stats?: LoopStats }): string => {
  const toolCalls = input.messages.flatMap((m) => toolRowsOf(m))
  const byTool = new Map<string, number>()
  for (const row of toolCalls) byTool.set(row.name, (byTool.get(row.name) ?? 0) + 1)
  const stats = input.stats
  const totals = stats?.tokenTotals
  const totalIn = totals?.inputTokens ?? stats?.usage?.inputTokens ?? 0
  const totalOut = totals?.outputTokens ?? stats?.usage?.outputTokens ?? 0
  const messageHtml = input.messages
    .map((m) => {
      const text = escapeHtml(textOf(m).slice(0, 4000))
      const tools = toolRowsOf(m)
        .map((t) => `<details><summary><code>${escapeHtml(t.name)}</code></summary><pre>${escapeHtml(t.input)}</pre><pre>${escapeHtml(t.output)}</pre></details>`)
        .join('\n')
      return `<section><h3>${escapeHtml(m.role)}</h3>${text ? `<pre>${text}</pre>` : ''}${tools}</section>`
    })
    .join('\n')
  const stepRow = stats
    ? `<tr><td>${(stats.stepCount ?? 1) - 1}</td><td>${stats.usage?.inputTokens}</td><td>${stats.usage?.outputTokens}</td><td>${escapeHtml(stats.finishReason ?? '')}</td></tr>`
    : ''
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><title>Session ${escapeHtml(input.sessionId)}</title><style>body{font-family:system-ui,sans-serif;max-width:960px;margin:0 auto;padding:24px}pre{background:#111;color:#ddd;padding:12px;border-radius:8px;overflow:auto;white-space:pre-wrap}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left}section{border:1px solid #ddd;border-radius:8px;padding:12px;margin:12px 0}</style></head><body><h1>Session ${escapeHtml(input.sessionId)}</h1><p>${escapeHtml(input.title ?? '')}</p><p>${input.messages.length} messages · ${toolCalls.length} tool calls (${[...byTool.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}) · ${input.stats?.stepCount ?? 0} steps · ${totalIn} in / ${totalOut} out tokens</p>${stepRow ? `<h2>Last step</h2><table><thead><tr><th>#</th><th>input</th><th>output</th><th>finish</th></tr></thead><tbody>${stepRow}</tbody></table>` : ''}<h2>Messages</h2>${messageHtml}</body></html>`
}

export const exportSessionHtml = async (input: ExportSessionInput): Promise<string> => {
  const cwd = input.cwd ?? options.app.cwd
  const dir = sessionDir(folderKeyFor(cwd))
  const meta = (await readJsonFile(join(dir, `${input.sessionId}.meta.json`))) as { title?: string } | undefined
  const stats = input.stats ?? ((await readJsonFile(join(dir, `${input.sessionId}.stats.json`))) as LoopStats | undefined)
  let messages = input.messages
  if (!messages) {
    const { loadSession } = await import('@agent/sessions/session-store.ts')
    messages = ((await loadSession(folderKeyFor(cwd), input.sessionId)) ?? []) as Array<LoopMessage>
  }
  const html = renderSessionHtml({ sessionId: input.sessionId, title: input.title ?? meta?.title, messages, stats })
  const out = resolve(input.out ?? `${input.sessionId}.html`)
  await Bun.write(out, html)
  return out
}
