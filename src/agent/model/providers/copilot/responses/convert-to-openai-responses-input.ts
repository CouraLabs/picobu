import { type LanguageModelV4Prompt, type SharedV4Warning, UnsupportedFunctionalityError } from '@ai-sdk/provider'
import { convertToBase64, parseProviderOptions } from '@ai-sdk/provider-utils'
import { z } from 'zod'
import type { OpenAIResponsesInput, OpenAIResponsesReasoning } from './openai-responses-api-types.ts'
import { localShellInputSchema, localShellOutputSchema } from './tool/local-shell.ts'

function isFileId(data: string, prefixes?: readonly string[]): boolean {
  if (!prefixes) return false
  return prefixes.some((prefix) => data.startsWith(prefix))
}

export async function convertToOpenAIResponsesInput({
  prompt,
  systemMessageMode,
  fileIdPrefixes,
  store,
  hasLocalShellTool = false,
}: {
  prompt: LanguageModelV4Prompt
  systemMessageMode: 'system' | 'developer' | 'remove'
  fileIdPrefixes?: readonly string[]
  store: boolean
  hasLocalShellTool?: boolean
}): Promise<{
  input: OpenAIResponsesInput
  warnings: Array<SharedV4Warning>
}> {
  const input: OpenAIResponsesInput = []
  const warnings: Array<SharedV4Warning> = []
  const processedApprovalIds = new Set<string>()

  for (const { role, content } of prompt) {
    switch (role) {
      case 'system': {
        switch (systemMessageMode) {
          case 'system': {
            input.push({ role: 'system', content })
            break
          }
          case 'developer': {
            input.push({ role: 'developer', content })
            break
          }
          case 'remove': {
            warnings.push({
              type: 'other',
              message: 'system messages are removed for this model',
            })
            break
          }
          default: {
            const _exhaustiveCheck: never = systemMessageMode
            throw new Error(`Unsupported system message mode: ${_exhaustiveCheck}`)
          }
        }
        break
      }

      case 'user': {
        input.push({
          role: 'user',
          content: content.map((part, index) => {
            switch (part.type) {
              case 'text': {
                return { type: 'input_text', text: part.text }
              }
              case 'file': {
                const data = part.data
                const detail = part.providerOptions?.copilot?.imageDetail as string | undefined

                if (part.mediaType.startsWith('image/')) {
                  const mediaType = part.mediaType === 'image/*' ? 'image/jpeg' : part.mediaType

                  if (data.type === 'url') {
                    return { type: 'input_image', image_url: data.url.toString(), detail }
                  }
                  if (data.type === 'data') {
                    if (typeof data.data === 'string' && isFileId(data.data, fileIdPrefixes)) {
                      return { type: 'input_image', file_id: data.data, detail }
                    }
                    return {
                      type: 'input_image',
                      image_url: `data:${mediaType};base64,${convertToBase64(data.data)}`,
                      detail,
                    }
                  }
                  throw new UnsupportedFunctionalityError({
                    functionality: `file part data type ${data.type}`,
                  })
                } else if (part.mediaType === 'application/pdf') {
                  if (data.type === 'url') {
                    return {
                      type: 'input_file',
                      file_url: data.url.toString(),
                    }
                  }
                  if (data.type === 'data') {
                    if (typeof data.data === 'string' && isFileId(data.data, fileIdPrefixes)) {
                      return { type: 'input_file', file_id: data.data }
                    }
                    return {
                      type: 'input_file',
                      filename: part.filename ?? `part-${index}.pdf`,
                      file_data: `data:application/pdf;base64,${convertToBase64(data.data)}`,
                    }
                  }
                  throw new UnsupportedFunctionalityError({
                    functionality: `file part data type ${data.type}`,
                  })
                } else {
                  throw new UnsupportedFunctionalityError({
                    functionality: `file part media type ${part.mediaType}`,
                  })
                }
              }
              default: {
                const _exhaustiveCheck: never = part
                throw new UnsupportedFunctionalityError({
                  functionality: `file part ${_exhaustiveCheck}`,
                })
              }
            }
          }),
        })

        break
      }

      case 'assistant': {
        const reasoningMessages: Record<string, OpenAIResponsesReasoning> = {}

        for (const part of content) {
          switch (part.type) {
            case 'text': {
              input.push({
                role: 'assistant',
                content: [{ type: 'output_text', text: part.text }],
                id: (part.providerOptions?.copilot?.itemId as string) ?? undefined,
              })
              break
            }
            case 'tool-call': {
              if (part.providerExecuted) {
                break
              }

              if (hasLocalShellTool && part.toolName === 'local_shell') {
                const parsedInput = localShellInputSchema.parse(part.input)
                input.push({
                  type: 'local_shell_call',
                  call_id: part.toolCallId,
                  id: (part.providerOptions?.copilot?.itemId as string) ?? undefined,
                  action: {
                    type: 'exec',
                    command: parsedInput.action.command,
                    timeout_ms: parsedInput.action.timeoutMs,
                    user: parsedInput.action.user,
                    working_directory: parsedInput.action.workingDirectory,
                    env: parsedInput.action.env,
                  },
                })

                break
              }

              input.push({
                type: 'function_call',
                call_id: part.toolCallId,
                name: part.toolName,
                arguments: JSON.stringify(part.input),
                id: (part.providerOptions?.copilot?.itemId as string) ?? undefined,
              })
              break
            }

            case 'tool-result': {
              if (store) {
                input.push({ type: 'item_reference', id: part.toolCallId })
              } else {
                warnings.push({
                  type: 'other',
                  message: `Results for OpenAI tool ${part.toolName} are not sent to the API when store is false`,
                })
              }

              break
            }

            case 'reasoning': {
              const providerOptions = await parseProviderOptions({
                provider: 'copilot',
                providerOptions: part.providerOptions,
                schema: openaiResponsesReasoningProviderOptionsSchema,
              })

              const reasoningId = providerOptions?.itemId

              if (reasoningId != null) {
                const reasoningMessage = reasoningMessages[reasoningId]

                if (store) {
                  if (reasoningMessage === undefined) {
                    input.push({ type: 'item_reference', id: reasoningId })

                    reasoningMessages[reasoningId] = {
                      type: 'reasoning',
                      id: reasoningId,
                      summary: [],
                    }
                  }
                } else {
                  const summaryParts: Array<{
                    type: 'summary_text'
                    text: string
                  }> = []

                  if (part.text.length > 0) {
                    summaryParts.push({
                      type: 'summary_text',
                      text: part.text,
                    })
                  } else if (reasoningMessage !== undefined) {
                    warnings.push({
                      type: 'other',
                      message: `Cannot append empty reasoning part to existing reasoning sequence. Skipping reasoning part: ${JSON.stringify(part)}.`,
                    })
                  }

                  if (reasoningMessage === undefined) {
                    reasoningMessages[reasoningId] = {
                      type: 'reasoning',
                      id: reasoningId,
                      encrypted_content: providerOptions?.reasoningEncryptedContent,
                      summary: summaryParts,
                    }
                    input.push(reasoningMessages[reasoningId])
                  } else {
                    reasoningMessage.summary.push(...summaryParts)
                  }
                }
              } else {
                warnings.push({
                  type: 'other',
                  message: `Non-OpenAI reasoning parts are not supported. Skipping reasoning part: ${JSON.stringify(part)}.`,
                })
              }
              break
            }
          }
        }

        break
      }

      case 'tool': {
        for (const part of content) {
          if (part.type === 'tool-approval-response') {
            if (processedApprovalIds.has(part.approvalId)) {
              continue
            }
            processedApprovalIds.add(part.approvalId)

            if (store) {
              input.push({
                type: 'item_reference',
                id: part.approvalId,
              })
            }

            input.push({
              type: 'mcp_approval_response',
              approval_request_id: part.approvalId,
              approve: part.approved,
            })
            continue
          }
          const output = part.output

          if (output.type === 'execution-denied') {
            const approvalId = (output.providerOptions?.copilot as { approvalId?: string } | undefined)?.approvalId

            if (approvalId) {
              continue
            }
          }

          if (hasLocalShellTool && part.toolName === 'local_shell' && output.type === 'json') {
            input.push({
              type: 'local_shell_call_output',
              call_id: part.toolCallId,
              output: localShellOutputSchema.parse(output.value).output,
            })
            break
          }

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

          input.push({
            type: 'function_call_output',
            call_id: part.toolCallId,
            output: contentValue,
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

  return { input, warnings }
}

const openaiResponsesReasoningProviderOptionsSchema = z.object({
  itemId: z.string().nullish(),
  reasoningEncryptedContent: z.string().nullish(),
})

export type OpenAIResponsesReasoningProviderOptions = z.infer<typeof openaiResponsesReasoningProviderOptionsSchema>
