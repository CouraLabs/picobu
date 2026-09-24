import { describe, expect, test } from 'bun:test'
import { NO_TOOLS } from '../../src/agent/agents/create-agent.ts'
import { buildActiveTools } from '../../src/agent/loop/active-tools.ts'

describe('buildActiveTools', () => {
  test('adds every mcp tool to a declared agent', () => {
    expect(buildActiveTools(['read'], ['read', 'write', 'mcp_a_x', 'mcp_a_y'], ['mcp_a_x', 'mcp_a_y'])).toEqual(['read', 'mcp_a_x', 'mcp_a_y'])
  })
  test('drops declared names that are not available', () => {
    expect(buildActiveTools(['read', 'ghost'], ['read', 'mcp_a_x'], ['mcp_a_x'])).toEqual(['read', 'mcp_a_x'])
  })
  test('empty declaration activates all available tools', () => {
    expect(buildActiveTools([], ['read', 'mcp_a_x'], ['mcp_a_x'])).toEqual(['read', 'mcp_a_x'])
  })
  test('NO_TOOLS opts out of both local and mcp tools', () => {
    expect(buildActiveTools([NO_TOOLS], ['read', 'mcp_a_x'], ['mcp_a_x'])).toEqual([])
  })
  test('does not duplicate an mcp tool the agent already declares', () => {
    expect(buildActiveTools(['read', 'mcp_a_x'], ['read', 'mcp_a_x'], ['mcp_a_x'])).toEqual(['read', 'mcp_a_x'])
  })
  test('ignores mcp names that are not in the available set', () => {
    expect(buildActiveTools(['read'], ['read'], ['mcp_missing'])).toEqual(['read'])
  })
})
