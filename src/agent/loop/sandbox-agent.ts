import type { LoopCallOptions } from '@agent/loop/types.ts'
import { createLocalSandboxSession, type LocalSandboxSession } from '@agent/tools/sandbox.ts'
import { options } from '@config/options.ts'
import type { ToolLoopAgent, ToolSet } from 'ai'

export type SandboxAgent = ToolLoopAgent<LoopCallOptions, ToolSet, Record<string, unknown>, never>

export const withSandbox = (loopAgent: SandboxAgent, cwd: string, enabled: () => boolean): SandboxAgent => {
  let session: LocalSandboxSession | undefined
  const sessionFor = (): LocalSandboxSession => {
    session ??= createLocalSandboxSession(cwd, options.app.shell)
    return session
  }
  return {
    get id() {
      return loopAgent.id
    },
    get tools() {
      return loopAgent.tools
    },
    stream: (callOptions: Parameters<typeof loopAgent.stream>[0]) => loopAgent.stream(enabled() ? { ...callOptions, experimental_sandbox: sessionFor() } : callOptions),
    generate: (callOptions: Parameters<typeof loopAgent.generate>[0]) => loopAgent.generate(enabled() ? { ...callOptions, experimental_sandbox: sessionFor() } : callOptions),
  } as SandboxAgent
}
