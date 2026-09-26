import { describe, expect, test } from 'bun:test'
import { bumpCatalog, catalogVersion } from '../../src/states/catalog-state.ts'

describe('catalog-state', () => {
  test('bumpCatalog increments the version', () => {
    const before = catalogVersion()
    bumpCatalog()
    expect(catalogVersion()).toBe(before + 1)
  })
})
