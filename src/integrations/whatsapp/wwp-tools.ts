import { addTodayTask, sendWwpMessage } from '@integrations/whatsapp/actions.ts'
import z from 'zod'

const sent = z.object({ message: z.string() })
const wwpMsgArgs = z.object({ phone: z.string(), message: z.string() })
const wwpTodayArgs = z.object({ text: z.string() })

export const wwpTools: Array<{
  name: string
  description: string
  parameters: z.ZodType
  output: z.ZodType
  kind: 'integration'
  handler: (args: unknown) => unknown
}> = [
  {
    name: 'wwp-msg',
    description: 'Send a WhatsApp text message to a phone number. Use when a WhatsApp user asks to message someone.',
    parameters: wwpMsgArgs,
    output: sent,
    kind: 'integration' as const,
    handler: async (args: unknown) => {
      const parsed = wwpMsgArgs.parse(args)
      return {
        message: await sendWwpMessage(parsed.phone, parsed.message),
      }
    },
  },
  {
    name: 'wwp-today',
    description: "Add a task to the user's 'today' todo list.",
    parameters: wwpTodayArgs,
    output: sent,
    kind: 'integration' as const,
    handler: async (args: unknown) => {
      const parsed = wwpTodayArgs.parse(args)
      return { message: await addTodayTask(parsed.text) }
    },
  },
]
