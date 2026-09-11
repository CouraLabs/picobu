import type { RGBA } from '@opentui/core'
import { theme } from '@states/theme-state.ts'
import type { NormalizedTokens } from './status-tokens.ts'

export const getContextLimit = (_modelKey?: unknown): number | undefined => undefined

export const getContextValue = (_tokens?: NormalizedTokens | undefined): number => 0

export const getContextPercent = (_modelKey?: unknown, _contextValue?: unknown): number => 0

export const getContextLabel = (_modelKey?: unknown, _contextValue?: unknown): string => '0'

export const getContextColor = (_percent?: unknown): string | RGBA => theme().text
