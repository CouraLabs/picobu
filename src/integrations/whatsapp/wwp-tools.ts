import z from "zod";
import {
  sendWwpMessage,
  addTodayTask,
} from "@integrations/whatsapp/actions.ts";

const sent = z.object({ message: z.string() });

/** WhatsApp / alert / reminder tools for the persistent agent. */
/** Tool defs share a widened shape so the heterogeneous array type-checks. */
export const wwpTools: {
  name: string;
  description: string;
  parameters: z.ZodType;
  output: z.ZodType;
  kind: "integration";
  handler: (args: any) => unknown;
}[] = [
  {
    name: "wwp-msg",
    description:
      "Send a WhatsApp text message to a phone number. Use when a WhatsApp user asks to message someone.",
    parameters: z.object({ phone: z.string(), message: z.string() }),
    output: sent,
    kind: "integration" as const,
    handler: async (args: { phone: string; message: string }) => ({
      message: await sendWwpMessage(args.phone, args.message),
    }),
  },
  {
    name: "wwp-today",
    description: "Add a task to the user's 'today' todo list.",
    parameters: z.object({ text: z.string() }),
    output: sent,
    kind: "integration" as const,
    handler: async (args: { text: string }) => ({ message: await addTodayTask(args.text) }),
  }
];
