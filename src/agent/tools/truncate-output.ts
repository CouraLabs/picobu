export const MAX_TOOL_OUTPUT_CHARS = 50000
export const TOOL_OUTPUT_TRUNCATION_SUFFIX = '\n…[truncated at 50000 chars — re-read in smaller chunks if needed]'

const truncateText = (text: string): string => (text.length > MAX_TOOL_OUTPUT_CHARS ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}${TOOL_OUTPUT_TRUNCATION_SUFFIX}` : text)

export const truncateToolOutput = (output: unknown): unknown => {
  if (typeof output === 'string') return truncateText(output)
  if (typeof output === 'object' && output !== null && !Array.isArray(output) && typeof (output as { content?: unknown }).content === 'string') {
    const source = output as { content: string }
    const content = truncateText(source.content)
    return content === source.content ? output : { ...source, content }
  }
  return output
}
