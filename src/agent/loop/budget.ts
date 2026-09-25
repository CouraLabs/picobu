import type { LoopStepCost } from '@agent/loop/loop-stats.ts'

export const budgetExceeded = (cost: LoopStepCost, limitUsd: number | undefined): boolean => typeof limitUsd === 'number' && limitUsd > 0 && cost.total > limitUsd
