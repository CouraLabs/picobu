import { type LanguageModelV4Prompt, type SharedV4ProviderOptions, UnsupportedFunctionalityError } from '@ai-sdk/provider'
import { convertToBase64 } from '@ai-sdk/provider-utils'
import type { OpenAICompatibleChatPrompt } from './openai-compatible-api-types.ts'

function getOpenAIMetadata(message: { providerOptions?: SharedV4ProviderOptions }) {
  return message?.providerOptions?.copilot ?? {}
}

export function convertToOpenAICompatibleChatMessages(prompt: LanguageModelV4Prompt): OpenAICompatibleChatPrompt {
  const messages: OpenAICompatibleChatPrompt = []
  for (const { role, content, ...message } of prompt) {
    const metadata = getOpenAIMetadata({ ...message })
    switch (role) {
      case 'system': {
        messages.push({
          role: 'system',
          content: content,
          ...metadata,
        })
        break
      }

      case 'user': {
        const firstPart = content[0]
        if (content.length === 1 && firstPart?.type === 'text') {
          messages.push({
            role: 'user',
            content: firstPart.text,
            ...getOpenAIMetadata(firstPart),
          })
          break
        }

        messages.push({
          role: 'user',
          content: content.map((part) => {
            const partMetadata = getOpenAIMetadata(part)
            if (part.type === 'text') {
              return { type: 'text', text: part.text, ...partMetadata }
            }
            if (part.mediaType.startsWith('image/')) {
              const mediaType = part.mediaType === 'image/*' ? 'image/jpeg' : part.mediaType

              const url = part.data.type === 'url' ? part.data.url.toString() : part.data.type === 'data' ? `data:${mediaType};base64,${convertToBase64(part.data.data)}` : undefined

              if (url == null) {
                throw new UnsupportedFunctionalityError({
                  functionality: `file part data type ${part.data.type}`,
                })
              }

              return {
                type: 'image_url',
                image_url: { url },
                ...partMetadata,
              }
            }
            throw new UnsupportedFunctionalityError({
              functionality: `file part media type ${part.mediaType}`,
            })
          }),
          ...metadata,
        })

        break
      }

      case 'assistant': {
        let text = ''
        let reasoningText: string | undefined
        let reasoningOpaque: string | undefined
        const toolCalls: Array<{
          id: string
          type: 'function'
          function: { name: string; arguments: string }
        }> = []

        for (const part of content) {
          const partMetadata = getOpenAIMetadata(part)
          const partOpaque = (part.providerOptions as { copilot?: { reasoningOpaque?: string } })?.copilot?.reasoningOpaque
          if (partOpaque && !reasoningOpaque) {
            reasoningOpaque = partOpaque
          }

          switch (part.type) {
            case 'text': {
              text += part.text
              break
            }
            case 'reasoning': {
              if (part.text) reasoningText = part.text
              break
            }
            case 'tool-call': {
              toolCalls.push({
                id: part.toolCallId,
                type: 'function',
                function: {
                  name: part.toolName,
                  arguments: JSON.stringify(part.input),
                },
                ...partMetadata,
              })
              break
            }
          }
        }

        messages.push({
          role: 'assistant',
          content: text || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          reasoning_text: reasoningOpaque ? reasoningText : undefined,
          reasoning_opaque: reasoningOpaque,
          ...metadata,
        })

        break
      }

      case 'tool': {
        for (const toolResponse of content) {
          if (toolResponse.type === 'tool-approval-response') {
            continue
          }
          const output = toolResponse.output

          let contentValue: string
          switch (output.type) {
            case 'text':
            case 'error-text':
              contentValue = output.value
              break
            case 'execution-denied':
              contentValue = output.reason ?? 'Tool execution denied.'
              break
            case 'content':
            case 'json':
            case 'error-json':
              contentValue = JSON.stringify(output.value)
              break
          }

          const toolResponseMetadata = getOpenAIMetadata(toolResponse)
          messages.push({
            role: 'tool',
            tool_call_id: toolResponse.toolCallId,
            content: contentValue,
            ...toolResponseMetadata,
          })
        }
        break
      }

      default: {
        const _exhaustiveCheck: never = role
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`)
      }
    }
  }

  return messages
}
