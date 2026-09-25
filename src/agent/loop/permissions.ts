import { extractValidatorContext, type ToolValidatorInput, type ToolValidatorResult, validateToolCall } from '@agent/prompts/tool-validator.ts'
import type { ToolKind } from '@agent/tools/toolset.ts'
import type { PermissionMode } from '@config/harness-options.ts'
import type { ModelMessage } from 'ai'

export const CONFIG_GATED_TOOLS: ReadonlyArray<string> = ['update-options', 'reload-options']

export const toolNeedsApproval = (toolName: string, permissions: Record<string, boolean> | undefined, mode: PermissionMode): boolean => mode !== 'yolo' && permissions?.[toolName] !== true

export const grantPermission = (permissions: Record<string, boolean> | undefined, toolName: string): Record<string, boolean> => ({ ...permissions, [toolName]: true })

export const isGatedTool = (name: string, kindOf: (toolName: string) => ToolKind | undefined): boolean => {
  const kind = kindOf(name)
  return kind === 'filesystem' || kind === undefined
}

export const isAutoPilotGated = (name: string, kindOf: (toolName: string) => ToolKind | undefined): boolean => kindOf(name) !== 'flow'

export type ToolValidatorFn = (input: ToolValidatorInput) => Promise<ToolValidatorResult>

export type ToolApprovalStatus = undefined | 'approved' | { type: 'denied'; reason: string } | 'user-approval'

export interface ToolApprovalInput {
  toolCall: { toolName: string; input?: unknown }
  messages?: Array<ModelMessage>
}

export type ToolApprovalFn = (options: ToolApprovalInput) => ToolApprovalStatus | Promise<ToolApprovalStatus>

export interface ToolApprovalContext {
  permissions?: Record<string, boolean>
  mode: PermissionMode
  kindOf: (toolName: string) => ToolKind | undefined
  subagent?: boolean
  sessionId?: string
  validate?: ToolValidatorFn
}

const buildAutoPilotApproval = (ctx: ToolApprovalContext): ToolApprovalFn => {
  const validate = ctx.validate ?? validateToolCall
  return async ({ toolCall, messages }) => {
    if (!isAutoPilotGated(toolCall.toolName, ctx.kindOf)) return undefined
    if (ctx.permissions?.[toolCall.toolName] === true) return 'approved'
    const result = await validate({
      toolName: toolCall.toolName,
      input: toolCall.input,
      ...extractValidatorContext(messages ?? []),
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    })
    if (result.approved) return 'approved'
    return { type: 'denied', reason: result.reason ?? `Auto-pilot denied ${toolCall.toolName}.` }
  }
}

export const buildToolApproval = (ctx: ToolApprovalContext): ToolApprovalFn | undefined => {
  if (ctx.subagent) return undefined
  if (ctx.mode === 'autopilot') return buildAutoPilotApproval(ctx)
  return ({ toolCall }) => (isGatedTool(toolCall.toolName, ctx.kindOf) && toolNeedsApproval(toolCall.toolName, ctx.permissions, ctx.mode) ? 'user-approval' : undefined)
}
