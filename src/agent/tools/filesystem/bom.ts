const BOM = '﻿'

export interface SplitBom {
  bom: boolean
  text: string
}

export const splitBom = (raw: string): SplitBom => (raw.startsWith(BOM) ? { bom: true, text: raw.slice(1) } : { bom: false, text: raw })

export const joinBom = (text: string, bom: boolean): string => (bom ? `${BOM}${text}` : text)

export const readFileWithBom = async (path: string): Promise<SplitBom & { exists: boolean }> => {
  const file = Bun.file(path)
  if (!(await file.exists())) return { bom: false, text: '', exists: false }
  const head = new Uint8Array(await file.slice(0, 3).arrayBuffer())
  const bom = head.length === 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf
  return { ...splitBom(await file.text()), bom, exists: true }
}

export const fileHasBom = async (path: string): Promise<boolean> => {
  const file = Bun.file(path)
  if (!(await file.exists())) return false
  const head = new Uint8Array(await file.slice(0, 3).arrayBuffer())
  return head.length === 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf
}
