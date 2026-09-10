export type FileEmbedding = {
  mimeType: string
  filename?: string
  dataUrl: string
}

export type PromptFile = {
  type: 'file'
  mediaType: string
  url: string
  filename?: string
}
export type ResolvedPrompt = {
  text: string
  files: PromptFile[]
}

const EITHER_TOKEN = /\[([TF])#(\d+) [^[\]]+\]/g
export const countLines = (text: string): number => {
  if (!text) return 0
  return text.split('\n').length
}
export const textEmbedLabel = (key: string, lineCount: number): string => `[${key} Pasted 1 ~ ${lineCount}]`
export const fileEmbedLabel = (key: string, mimeType: string): string => `[${key} File ${mimeType}]`

export const bytesToDataUrl = (bytes: Uint8Array, mimeType: string): string => `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`

export const resolvePrompt = (rawText: string, textEmbeds: Record<string, string>, fileEmbeds: Record<string, FileEmbedding>): ResolvedPrompt => {
  const files: PromptFile[] = []
  const text = rawText.replace(EITHER_TOKEN, (_match, type: string, id: string) => {
    const key = `${type}#${id}`
    if (type === 'F') {
      const file = fileEmbeds[key]
      if (file) {
        files.push({
          type: 'file',
          mediaType: file.mimeType,
          url: file.dataUrl,
          filename: file.filename,
        })
      }
      return ''
    }
    return textEmbeds[key] ?? ''
  })
  return { text, files }
}
