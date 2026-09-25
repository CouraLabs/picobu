import type { HarnessOptions } from '@config/options.ts'

export type PermissionMode = 'yolo' | 'ask' | 'autopilot'
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'ask'

export const cyclePermissionMode = (mode: PermissionMode): PermissionMode => (mode === 'yolo' ? 'ask' : mode === 'ask' ? 'autopilot' : 'yolo')

export const normalizeHarness = (value: unknown): HarnessOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const harness = value as HarnessOptions
  const normalized: HarnessOptions = {}
  if (harness.defaultModel !== undefined) {
    if (typeof harness.defaultModel !== 'string' || harness.defaultModel.trim().length === 0) {
      throw new Error('options.json: "harness.defaultModel" must be a non-empty string like "<providerId>/<modelId>"')
    }
    normalized.defaultModel = harness.defaultModel
  }
  if (harness.maxAgents !== undefined) {
    if (typeof harness.maxAgents !== 'number' || !Number.isFinite(harness.maxAgents) || harness.maxAgents < 1) {
      throw new Error('options.json: "harness.maxAgents" must be a number >= 1')
    }
    normalized.maxAgents = Math.floor(harness.maxAgents)
  }
  if (harness.modelRoles !== undefined) {
    if (!harness.modelRoles || typeof harness.modelRoles !== 'object' || Array.isArray(harness.modelRoles)) {
      throw new Error('options.json: "harness.modelRoles" must be an object')
    }
    normalized.modelRoles = harness.modelRoles
  }
  if (harness.agent !== undefined) {
    if (typeof harness.agent !== 'object' || harness.agent === null || Array.isArray(harness.agent)) {
      throw new Error('options.json: "harness.agent" must be an object of agent-id -> model-role or "providerId/modelId"')
    }
    const agent: Record<string, string> = {}
    for (const [key, value] of Object.entries(harness.agent)) {
      if (key.trim().length === 0) continue
      if (typeof value !== 'string' || value.trim().length === 0) continue
      agent[key] = value.trim()
    }
    normalized.agent = agent
  }
  if (harness.doomLoop !== undefined) {
    if (typeof harness.doomLoop !== 'boolean') {
      throw new Error('options.json: "harness.doomLoop" must be a boolean')
    }
    normalized.doomLoop = harness.doomLoop
  }
  if (harness.permissions !== undefined) {
    if (typeof harness.permissions !== 'object' || harness.permissions === null || Array.isArray(harness.permissions)) {
      throw new Error('options.json: "harness.permissions" must be an object of tool-name -> boolean')
    }
    const permissions: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(harness.permissions)) {
      if (key.trim().length === 0) continue
      if (typeof value !== 'boolean') continue
      permissions[key] = value
    }
    normalized.permissions = permissions
  }
  if (harness.budgetLimitUsd !== undefined) {
    if (typeof harness.budgetLimitUsd !== 'number' || !Number.isFinite(harness.budgetLimitUsd) || harness.budgetLimitUsd < 0) {
      throw new Error('options.json: "harness.budgetLimitUsd" must be a number >= 0')
    }
    normalized.budgetLimitUsd = harness.budgetLimitUsd
  }
  if (harness.defaultPermissionMode !== undefined) {
    if (harness.defaultPermissionMode !== 'yolo' && harness.defaultPermissionMode !== 'ask' && harness.defaultPermissionMode !== 'autopilot') {
      throw new Error('options.json: "harness.defaultPermissionMode" must be "yolo", "ask" or "autopilot"')
    }
    normalized.defaultPermissionMode = harness.defaultPermissionMode
  }
  return normalized
}
