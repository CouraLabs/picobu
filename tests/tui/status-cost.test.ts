import { describe, expect, test } from 'bun:test'
import { getCostSplit, getCostValue, getResponseTimeLabel, getStepTimeLabel, getToolExecLabel, getTpsLabel, getTtftLabel } from '../../src/tui/components/session/status/session-status-data.ts'

describe('status cost display', () => {
  test('cost value always shows zero', () => {
    expect(getCostValue(undefined, undefined, undefined)).toBe('0')
    expect(getCostValue({} as never, { finishReason: 'stop' } as never, { finishReason: 'stop' } as never)).toBe('0')
  })
  test('split always hides', () => {
    expect(getCostSplit(undefined)).toBeUndefined()
    expect(getCostSplit({} as never)).toBeUndefined()
  })
})

describe('status performance display', () => {
  test('tps and ttft show placeholder', () => {
    expect(getTpsLabel(undefined, undefined)).toBe('–')
    expect(getTtftLabel(undefined, undefined)).toBe('–')
    expect(getTpsLabel({} as never, undefined)).toBe('–')
  })
  test('timing labels show placeholder', () => {
    expect(getStepTimeLabel(undefined)).toBe('–')
    expect(getResponseTimeLabel(undefined)).toBe('–')
    expect(getToolExecLabel(undefined)).toBe('–')
    expect(getToolExecLabel({} as never)).toBe('–')
  })
})
