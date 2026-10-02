const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const OSC_MAX_PAYLOAD = 2048
const ANSI_PATTERN = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]{0,${OSC_MAX_PAYLOAD}}(?:${BEL}|${ESC}\\\\)|[@-_])?`, 'g')
const ZERO_WIDTH_CODES = new Set([0x200b, 0x2060, 0xfeff])

const isControlCode = (code: number): boolean => code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)

const stripControlCharacters = (text: string): string => {
  let out = ''
  let changed = false
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code === 0x0d) {
      out += '\n'
      changed = true
      if (text.charCodeAt(index + 1) === 0x0a) index += 1
      continue
    }
    if (code === 0x2028 || code === 0x2029) {
      out += '\n'
      changed = true
      continue
    }
    if (isControlCode(code) || ZERO_WIDTH_CODES.has(code)) {
      changed = true
      continue
    }
    out += text.charAt(index)
  }
  return changed ? out : text
}

export const replaceUnpairedSurrogates = (text: string): string => {
  let out = ''
  let changed = false
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text.charAt(index) + text.charAt(index + 1)
        index += 1
        continue
      }
      out += '\ufffd'
      changed = true
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += '\ufffd'
      changed = true
      continue
    }
    out += text.charAt(index)
  }
  return changed ? out : text
}

export const sanitizePromptText = (text: string): string => replaceUnpairedSurrogates(stripControlCharacters(text.replace(ANSI_PATTERN, '')))
