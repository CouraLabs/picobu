import { isStepCount } from 'ai'

export const hasValidToolCall =
  (...toolNames: Array<string>) =>
  ({ steps }: { steps: Array<{ toolCalls?: Array<{ toolName: string; invalid?: boolean }> }> }) => {
    const lastStep = steps.at(-1)
    return lastStep?.toolCalls?.some((toolCall) => toolNames.includes(toolCall.toolName) && !toolCall.invalid) ?? false
  }

export const buildStopWhen = (options: { subagent: boolean; persistent: boolean }) => {
  if (options.persistent) return [isStepCount(100), hasValidToolCall('ask', 'plan-write', 'plan-exit')]
  const blocking: Array<string> = options.subagent ? [] : ['ask', 'plan-write', 'plan-exit']
  return blocking.length ? [isStepCount(100), hasValidToolCall(...blocking)] : [isStepCount(100)]
}
