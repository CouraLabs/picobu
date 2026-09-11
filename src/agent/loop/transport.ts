import type { LoopCallOptions, LoopMessage } from '@agent/loop/types.ts'
import { describeError } from '@shared/error-report.ts'
import { DirectChatTransport, type ToolLoopAgent, type ToolSet } from 'ai'

export const formatStreamError = (error: unknown): string => {
  const report = describeError(error)
  return report.detail ? `${report.message}\n${report.detail}` : report.message
}

export const createLoopTransport = (
  agent: ToolLoopAgent<LoopCallOptions, ToolSet, Record<string, unknown>, never>,
  isPersistent: boolean,
): DirectChatTransport<LoopCallOptions, ToolSet, Record<string, unknown>, never, LoopMessage> =>
  new DirectChatTransport({
    agent,
    options: { sessionMode: isPersistent ? 'persistent' : 'chat' },
    sendFinish: true,
    sendReasoning: true,
    sendSources: true,
    sendStart: true,
    onError: formatStreamError,
  })
