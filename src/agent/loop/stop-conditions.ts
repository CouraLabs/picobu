import { isStepCount } from 'ai'

export const hasValidToolCall =
  (...toolNames: Array<string>) =>
  ({ steps }: { steps: Array<{ toolCalls?: Array<{ toolName: string; invalid?: boolean }> }> }) => {
    const lastStep = steps.at(-1)
    return lastStep?.toolCalls?.some((toolCall) => toolNames.includes(toolCall.toolName) && !toolCall.invalid) ?? false
  }

export const buildStopWhen = (options: { subagent: boolean; persistent: boolean; hasHalted?: () => boolean }) => {
  const blockingTools = ['ask', 'plan-write', 'plan-exit', 'grill-exit']
  const halt = options.hasHalted ? [() => options.hasHalted?.() === true] : []
  if (options.persistent) return [isStepCount(100), hasValidToolCall(...blockingTools), ...halt]
  return [...(blockingTools.length ? [hasValidToolCall(...blockingTools)] : []), ...halt]
}
