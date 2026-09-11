import type { LoopCallOptions } from '@agent/loop/types.ts'
import { createLocalSandboxSession } from '@agent/tools/sandbox.ts'
import { options } from '@config/options.ts'
import type { ToolLoopAgent, ToolSet } from 'ai'

export type SandboxAgent = ToolLoopAgent<LoopCallOptions, ToolSet, Record<string, unknown>, never>

export const withSandbox = (loopAgent: SandboxAgent, cwd: string, enabled: boolean): SandboxAgent => {
  if (!enabled) return loopAgent
  const sandboxSession = createLocalSandboxSession(cwd, options.app.shell)
  return {
    get id() {
      return loopAgent.id
    },
    get tools() {
      return loopAgent.tools
    },
    stream: (callOptions: Parameters<typeof loopAgent.stream>[0]) => loopAgent.stream({ ...callOptions, experimental_sandbox: sandboxSession }),
    generate: (callOptions: Parameters<typeof loopAgent.generate>[0]) => loopAgent.generate({ ...callOptions, experimental_sandbox: sandboxSession }),
  } as SandboxAgent
}
