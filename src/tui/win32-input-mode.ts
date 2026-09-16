import type { CliRenderer } from '@opentui/core'

// ParsedKeyLike shape from @opentui/core (lib/parse.keypress.d.ts, not exported from the
// package root); structurally identical objects are accepted by keyInput.processParsedKey.
export interface ParsedKeyLike {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  option: boolean
  sequence: string
  number: boolean
  raw: string
  eventType: 'press' | 'repeat' | 'release'
  source: 'raw' | 'kitty'
  code?: string
  super?: boolean
  hyper?: boolean
  capsLock?: boolean
  numLock?: boolean
  baseCode?: number
  repeated?: boolean
}

// win32-input-mode (DECSET 9001) makes ConPTY report every keystroke as an explicit
// CSI sequence instead of legacy bytes, so keys that legacy encoding collapses
// (ctrl+h -> 0x08, esc timing) arrive unambiguous. Enabled only when the kitty
// keyboard protocol is not available; unknown/unsupported terminals ignore the
// DECSET and the decoder simply never matches.
//
// Sequence shape (learn.microsoft.com/windows/console/win32-input-mode):
//   ESC [ Vk ; Sc ; Uc ; Kc ; Rc ; Mods _   (key down)
//   ESC [ Vk ; Sc ; Uc ; Kc ; Rc ; Mods ~   (key up)

const WIN32_SEQUENCE_RE = new RegExp(`${String.fromCharCode(27)}\\[(\\d+);(\\d+);(\\d+);(\\d+);(\\d+);(\\d+)([_~])`, 'g')

// ControlKeyState bits from winuser.h.
const RIGHT_ALT_PRESSED = 0x0001
const LEFT_ALT_PRESSED = 0x0002
const RIGHT_CTRL_PRESSED = 0x0004
const LEFT_CTRL_PRESSED = 0x0008
const SHIFT_PRESSED = 0x0010
const CTRL_BITS = LEFT_CTRL_PRESSED | RIGHT_CTRL_PRESSED
const ALT_BITS = LEFT_ALT_PRESSED | RIGHT_ALT_PRESSED

const HIGH_SURROGATE_MIN = 0xd800
const HIGH_SURROGATE_MAX = 0xdbff
const LOW_SURROGATE_MIN = 0xdc00
const LOW_SURROGATE_MAX = 0xdfff

const VK_NAMES: Record<number, string> = {
  8: 'backspace',
  9: 'tab',
  13: 'return',
  27: 'escape',
  32: 'space',
  33: 'pageup',
  34: 'pagedown',
  35: 'end',
  36: 'home',
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  45: 'insert',
  46: 'delete',
}

// Synthesized sequences mirror what OpenTUI's legacy parser produces, so downstream
// consumers (editors, dialogs) see identical keys. Backspace uses 0x7F to keep it
// distinguishable from a legacy ctrl+h (0x08) when both paths are active.
const VK_SEQUENCES: Record<string, string> = {
  escape: String.fromCharCode(27),
  return: String.fromCharCode(13),
  tab: String.fromCharCode(9),
  backspace: String.fromCharCode(127),
  space: ' ',
}

const vkFunctionKey = (vk: number): string | undefined => (vk >= 112 && vk <= 123 ? `f${vk - 111}` : undefined)

const vkLetterOrDigit = (vk: number): string | undefined => {
  if (vk >= 65 && vk <= 90) return String.fromCharCode(vk + 32)
  if (vk >= 48 && vk <= 57) return String.fromCharCode(vk)
  return undefined
}

const toKey = (vk: number, uc: number, mods: number, raw: string): ParsedKeyLike | undefined => {
  const ctrl = (mods & CTRL_BITS) !== 0
  const meta = (mods & ALT_BITS) !== 0
  const shift = (mods & SHIFT_PRESSED) !== 0
  // AltGr reports RIGHT_ALT (often with LEFT_CTRL); it is text entry, not a chord.
  const altGrText = (mods & RIGHT_ALT_PRESSED) !== 0 && uc >= 0x20
  const effectiveCtrl = altGrText ? false : ctrl
  const effectiveMeta = altGrText ? false : meta
  const named = VK_NAMES[vk] ?? vkFunctionKey(vk)
  if (named) {
    return {
      name: named,
      sequence: VK_SEQUENCES[named] ?? '',
      ctrl: effectiveCtrl,
      meta: effectiveMeta,
      shift,
      option: false,
      number: false,
      raw,
      eventType: 'press',
      source: 'raw',
    }
  }
  const letterDigit = vkLetterOrDigit(vk)
  const name = uc >= 0x20 ? String.fromCharCode(uc).toLowerCase() : letterDigit
  if (!name) return undefined
  return {
    name,
    sequence: uc > 0 ? String.fromCharCode(uc) : '',
    ctrl: effectiveCtrl,
    meta: effectiveMeta,
    shift,
    option: false,
    number: /^[0-9]$/.test(name),
    raw,
    eventType: 'press',
    source: 'raw',
  }
}

// Returns the decoded keys, or null when the sequence is not win32-input-mode input
// (so the caller can let OpenTUI's parser handle it). Matched-but-synthetic-nothing
// input (modifier-only keys, key-up events) decodes to an empty array.
export const decodeWin32Input = (sequence: string): Array<ParsedKeyLike> | null => {
  WIN32_SEQUENCE_RE.lastIndex = 0
  const matches = Array.from(sequence.matchAll(WIN32_SEQUENCE_RE))
  if (matches.length === 0) return null
  let covered = 0
  for (const match of matches) covered += match[0].length
  if (covered !== sequence.length) return null

  const keys: Array<ParsedKeyLike> = []
  let pendingHighSurrogate: number | undefined
  for (const match of matches) {
    const vk = Number(match[1])
    const uc = Number(match[3])
    const keyDown = match[7] === '_' && Number(match[4]) > 0
    if (!keyDown) continue
    if (uc >= HIGH_SURROGATE_MIN && uc <= HIGH_SURROGATE_MAX) {
      // A dangling high surrogate (no low surrogate follows) is dropped rather than
      // emitted as a broken half; ConPTY always sends valid pairs in practice.
      pendingHighSurrogate = uc
      continue
    }
    if (uc >= LOW_SURROGATE_MIN && uc <= LOW_SURROGATE_MAX && pendingHighSurrogate !== undefined) {
      const codePoint = 0x10000 + ((pendingHighSurrogate - HIGH_SURROGATE_MIN) << 10) + (uc - LOW_SURROGATE_MIN)
      pendingHighSurrogate = undefined
      const mods = Number(match[6])
      const char = String.fromCodePoint(codePoint)
      const altGrText = (mods & RIGHT_ALT_PRESSED) !== 0
      keys.push({
        name: char.toLowerCase(),
        sequence: char,
        ctrl: false,
        meta: !altGrText && (mods & ALT_BITS) !== 0,
        shift: (mods & SHIFT_PRESSED) !== 0,
        option: false,
        number: false,
        raw: match[0],
        eventType: 'press',
        source: 'raw',
      })
      continue
    }
    pendingHighSurrogate = undefined
    const key = toKey(vk, uc, Number(match[6]), match[0])
    if (key) keys.push(key)
  }
  return keys
}

// Enables win32-input-mode and installs a prepended input handler that decodes its
// sequences into synthetic key events. Returns a disposer that removes the handler
// and writes the disable sequence.
export const enableWin32InputMode = (renderer: CliRenderer): (() => void) => {
  const keyInput = renderer.keyInput
  const handler = (sequence: string): boolean => {
    const decoded = decodeWin32Input(sequence)
    if (decoded === null) return false
    for (const key of decoded) keyInput.processParsedKey(key)
    return true
  }
  renderer.prependInputHandler(handler)
  process.stdout.write('[9001h')
  return () => {
    renderer.removeInputHandler(handler)
    process.stdout.write('[9001l')
  }
}
