import { describe, expect, test } from 'bun:test'
import { decodeWin32Input } from '../../src/tui/win32-input-mode.ts'

const ESC = String.fromCharCode(27)

// win32-input-mode: ESC [ Vk ; Sc ; Uc ; Kc ; Rc ; Mods ( _ = down | ~ = up )
const seq = (vk: number, uc: number, mods: number, down = true): string => `${ESC}[${vk};0;${uc};${down ? 1 : 0};1;${mods}${down ? '_' : '~'}`

const RIGHT_ALT = 0x0001
const LEFT_ALT = 0x0002
const LEFT_CTRL = 0x0008
const SHIFT = 0x0010

describe('decodeWin32Input', () => {
  test('non-win32 sequences pass through as null', () => {
    expect(decodeWin32Input('a')).toBeNull()
    expect(decodeWin32Input(`${ESC}[A`)).toBeNull()
    expect(decodeWin32Input(`${ESC}[27;1;1_`)).toBeNull()
    expect(decodeWin32Input('')).toBeNull()
  })

  test('escape arrives unambiguous', () => {
    const keys = decodeWin32Input(seq(27, 27, 0))
    expect(keys).toHaveLength(1)
    expect(keys?.[0]).toMatchObject({ name: 'escape', sequence: ESC, ctrl: false, meta: false, shift: false, eventType: 'press', source: 'raw' })
  })

  test('ctrl+h decodes as ctrl+h, not backspace', () => {
    const keys = decodeWin32Input(seq(72, 8, LEFT_CTRL))
    expect(keys).toHaveLength(1)
    expect(keys?.[0]).toMatchObject({ name: 'h', ctrl: true, shift: false })
  })

  test('ctrl+shift+h keeps both modifiers', () => {
    const keys = decodeWin32Input(seq(72, 8, LEFT_CTRL | SHIFT))
    expect(keys?.[0]).toMatchObject({ name: 'h', ctrl: true, shift: true })
  })

  test('alt+h decodes as meta+h even with no character', () => {
    const keys = decodeWin32Input(seq(72, 0, LEFT_ALT))
    expect(keys?.[0]).toMatchObject({ name: 'h', meta: true, ctrl: false, sequence: '' })
  })

  test('ctrl+c decodes as ctrl+c for copy handling', () => {
    const keys = decodeWin32Input(seq(67, 3, LEFT_CTRL))
    expect(keys?.[0]).toMatchObject({ name: 'c', ctrl: true, sequence: String.fromCharCode(3) })
  })

  test('plain and shifted letters', () => {
    expect(decodeWin32Input(seq(65, 97, 0))?.[0]).toMatchObject({ name: 'a', sequence: 'a', shift: false })
    expect(decodeWin32Input(seq(65, 65, SHIFT))?.[0]).toMatchObject({ name: 'a', sequence: 'A', shift: true })
  })

  test('digits report number flag', () => {
    const keys = decodeWin32Input(seq(49, 49, 0))
    expect(keys?.[0]).toMatchObject({ name: '1', sequence: '1', number: true })
  })

  interface NamedKeyCase {
    vk: number
    uc: number
    name: string
    sequence?: string
  }
  const namedKeyCases: Array<NamedKeyCase> = [
    { vk: 13, uc: 13, name: 'return', sequence: '\r' },
    { vk: 9, uc: 9, name: 'tab', sequence: '\t' },
    { vk: 8, uc: 8, name: 'backspace', sequence: String.fromCharCode(127) },
    { vk: 32, uc: 32, name: 'space', sequence: ' ' },
    { vk: 38, uc: 0, name: 'up' },
    { vk: 37, uc: 0, name: 'left' },
    { vk: 39, uc: 0, name: 'right' },
    { vk: 40, uc: 0, name: 'down' },
    { vk: 36, uc: 0, name: 'home' },
    { vk: 35, uc: 0, name: 'end' },
    { vk: 33, uc: 0, name: 'pageup' },
    { vk: 34, uc: 0, name: 'pagedown' },
    { vk: 46, uc: 0, name: 'delete' },
    { vk: 45, uc: 0, name: 'insert' },
    { vk: 112, uc: 0, name: 'f1' },
    { vk: 113, uc: 0, name: 'f2' },
    { vk: 114, uc: 0, name: 'f3' },
    { vk: 115, uc: 0, name: 'f4' },
    { vk: 123, uc: 0, name: 'f12' },
  ]
  test.each(namedKeyCases)('vk $vk maps to opentui name $name', (row) => {
    const expected: Record<string, string> = { name: row.name }
    if (row.sequence !== undefined) expected.sequence = row.sequence
    expect(decodeWin32Input(seq(row.vk, row.uc, 0))?.[0]).toMatchObject(expected)
  })

  test('key-up events are consumed but emit nothing', () => {
    expect(decodeWin32Input(seq(65, 97, 0, false))).toEqual([])
    expect(decodeWin32Input(seq(27, 27, 0, false))).toEqual([])
  })

  test('modifier-only presses (uc=0, unknown vk) emit nothing but are consumed', () => {
    expect(decodeWin32Input(seq(17, 0, LEFT_CTRL))).toEqual([])
    expect(decodeWin32Input(seq(16, 0, SHIFT))).toEqual([])
    expect(decodeWin32Input(seq(18, 0, LEFT_ALT))).toEqual([])
  })

  test('unknown vk with no character is dropped', () => {
    expect(decodeWin32Input(seq(255, 0, 0))).toEqual([])
  })

  test('altgr printable input is text, not a ctrl+alt chord', () => {
    const keys = decodeWin32Input(seq(81, 64, RIGHT_ALT | LEFT_CTRL))
    expect(keys?.[0]).toMatchObject({ name: '@', sequence: '@', ctrl: false, meta: false })
  })

  test('batched sequences decode in order', () => {
    const keys = decodeWin32Input(seq(65, 97, 0) + seq(66, 98, 0) + seq(27, 27, 0))
    expect(keys).toHaveLength(3)
    expect(keys?.map((k) => k.name)).toEqual(['a', 'b', 'escape'])
  })

  test('partial or mixed input falls back to null', () => {
    expect(decodeWin32Input(`${seq(65, 97, 0)}x`)).toBeNull()
    expect(decodeWin32Input(`x${seq(65, 97, 0)}`)).toBeNull()
    expect(decodeWin32Input(`${ESC}[65;0;`)).toBeNull()
  })

  test('surrogate pairs combine into one key', () => {
    const high = 0xd83d
    const low = 0xde00
    const keys = decodeWin32Input(seq(65, high, 0) + seq(65, low, 0))
    expect(keys).toHaveLength(1)
    expect(keys?.[0]?.sequence).toBe('😀')
  })
})
