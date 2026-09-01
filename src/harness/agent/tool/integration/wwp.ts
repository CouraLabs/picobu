import z from "zod";
import {
  sendWwpMessage,
  createWwpAlert,
  listWwpAlerts,
  removeWwpAlert,
  addTodayTask,
  listTodayTasks,
  createWwpReminder,
  listWwpReminders,
  removeWwpReminder,
} from "../../../../integrations/whatsapp/actions";

const sent = z.object({ message: z.string() });
const created = z.object({ id: z.string(), name: z.string() });

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
    name: "wwp-alert",
    description:
      "Create a WhatsApp alert: sends `message` to `phone` daily at `timeOfDay` (HH:MM). Level sets urgency: 1 = plain message, 2 = + desktop notification, 3+ = urgent prefixed delivery.",
    parameters: z.object({
      phone: z.string(),
      message: z.string(),
      level: z.number().int().min(1).max(5),
      timeOfDay: z.string(),
    }),
    output: created,
    kind: "integration" as const,
    handler: (args: { phone: string; message: string; level: number; timeOfDay: string }) => {
      const job = createWwpAlert(args.phone, args.message, args.level, args.timeOfDay);
      return Promise.resolve({ id: job.id, name: job.name });
    },
  },
  {
    name: "wwp-list-alerts",
    description: "List all active WhatsApp alerts with their IDs.",
    parameters: z.object({}),
    output: z.object({ alerts: z.array(created) }),
    kind: "integration" as const,
    handler: async () => ({
      alerts: (await listWwpAlerts()).map((j) => ({ id: j.id, name: j.name })),
    }),
  },
  {
    name: "wwp-rm-alert",
    description: "Remove a WhatsApp alert by its ID.",
    parameters: z.object({ id: z.string() }),
    output: sent,
    kind: "integration" as const,
    handler: async (args: { id: string }) => ({ message: await removeWwpAlert(args.id) }),
  },
  {
    name: "wwp-today",
    description: "Add a task to the user's 'today' todo list.",
    parameters: z.object({ text: z.string() }),
    output: sent,
    kind: "integration" as const,
    handler: async (args: { text: string }) => ({ message: await addTodayTask(args.text) }),
  },
  {
    name: "wwp-reminder",
    description:
      "Create a recurring reminder. Frequency like 'daily', 'hourly', 'every 30m'; an HH:MM repeatAt makes it a daily anchor. Delivered as a desktop notification.",
    parameters: z.object({
      frequency: z.string(),
      description: z.string(),
      repeatAt: z.string(),
    }),
    output: created,
    kind: "integration" as const,
    handler: (args: { frequency: string; description: string; repeatAt: string }) => {
      const job = createWwpReminder(args.frequency, args.description, args.repeatAt);
      return Promise.resolve({ id: job.id, name: job.name });
    },
  },
  {
    name: "wwp-list-reminders",
    description: "List recurring reminders and/or today's tasks with their IDs.",
    parameters: z.object({ type: z.enum(["reminders", "today", "all"]) }),
    output: z.object({
      reminders: z.array(z.object({ id: z.string(), name: z.string() })),
      today: z.array(z.object({ id: z.string(), text: z.string() })),
    }),
    kind: "integration" as const,
    handler: async (args: { type: "reminders" | "today" | "all" }) => {
      const { reminders, today } = await listWwpReminders(args.type === "all" ? "" : args.type);
      return {
        reminders: reminders.map((j) => ({ id: j.id, name: j.name })),
        today: today.map((t) => ({ id: t.id, text: t.text })),
      };
    },
  },
  {
    name: "wwp-rm-reminder",
    description: "Remove a recurring reminder or today-task by its ID.",
    parameters: z.object({ id: z.string() }),
    output: sent,
    kind: "integration" as const,
    handler: async (args: { id: string }) => ({ message: await removeWwpReminder(args.id) }),
  },
];
