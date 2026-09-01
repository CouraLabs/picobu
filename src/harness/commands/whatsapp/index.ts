import type { Command } from "../types";
import { loopStore } from "../../../stores/loop-store";
import { footerToastStore } from "../../../stores/footer-toast-store";
import {
  sendWwpMessage,
  createWwpAlert,
  listWwpAlerts,
  removeWwpAlert,
  addTodayTask,
  createWwpReminder,
  listWwpReminders,
  removeWwpReminder,
  listTodayTasks,
} from "../../../integrations/whatsapp/actions";
import { scheduleLabel } from "../../../cron/schedule";

/** Pipe-separated args: `<a>|<b>|...` trimmed. */
const parts = (args: string): string[] => args.split("|").map((p) => p.trim());

const toast = (message: string): void => footerToastStore.trigger.show({ message });

const fail = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * WhatsApp integration commands. Results are shown as footer toasts (list
 * commands also log to the WhatsApp tab via the shared activity log).
 */
export const WWP_COMMANDS: Command[] = [
  {
    kind: "system",
    name: "wwp:contacts",
    aliases: [],
    title: "wwp:contacts",
    description: "List known WhatsApp contacts; pick one to message",
    path: "",
    handler: () => loopStore.trigger.openContactsPicker(),
  },
  {
    kind: "system",
    name: "wwp:msg",
    aliases: [],
    title: "wwp:msg",
    description: "Send a WhatsApp message (/wwp:msg <phone>|<msg>)",
    path: "",
    handler: (args) => {
      const [phone, msg] = parts(args);
      void sendWwpMessage(phone ?? "", msg ?? "")
        .then(toast)
        .catch((e) => toast(`wwp:msg failed: ${fail(e)}`));
    },
  },
  {
    kind: "system",
    name: "wwp:alert",
    aliases: [],
    title: "wwp:alert",
    description: "Create a WhatsApp alert (/wwp:alert <phone>|<msg>|<level>|<HH:MM>)",
    path: "",
    handler: (args) => {
      const [phone, msg, level, timeOfDay] = parts(args);
      try {
        const job = createWwpAlert(phone ?? "", msg ?? "", Number(level ?? 1), timeOfDay ?? "");
        toast(`Alert created: ${scheduleLabel(job.schedule)} (id ${job.id})`);
      } catch (e) {
        toast(`wwp:alert failed: ${fail(e)}`);
      }
    },
  },
  {
    kind: "system",
    name: "wwp:list-alerts",
    aliases: [],
    title: "wwp:list-alerts",
    description: "List all active WhatsApp alerts",
    path: "",
    handler: () => {
      void listWwpAlerts().then((jobs) => {
        toast(
          jobs.length
            ? `Active alerts:\n${jobs.map((j) => `  ${j.id} — ${j.name} (${scheduleLabel(j.schedule)})`).join("\n")}`
            : "No active alerts",
        );
      });
    },
  },
  {
    kind: "system",
    name: "wwp:rm-alert",
    aliases: [],
    title: "wwp:rm-alert",
    description: "Remove an alert (/wwp:rm-alert <alert-id>)",
    path: "",
    handler: (args) => {
      void removeWwpReminder(args.trim())
        .catch(() => removeWwpAlert(args.trim()))
        .then(toast)
        .catch((e) => toast(`wwp:rm-alert failed: ${fail(e)}`));
    },
  },
  {
    kind: "system",
    name: "wwp:today",
    aliases: [],
    title: "wwp:today",
    description: "Add a task to today's list (/wwp:today <todo-text>)",
    path: "",
    handler: (args) => {
      void addTodayTask(args.trim())
        .then(toast)
        .catch((e) => toast(`wwp:today failed: ${fail(e)}`));
    },
  },
  {
    kind: "system",
    name: "wwp:reminder",
    aliases: [],
    title: "wwp:reminder",
    description: "Create a recurring reminder (/wwp:reminder <frequency>|<description>|<HH:MM>)",
    path: "",
    handler: (args) => {
      const [frequency, description, repeatAt] = parts(args);
      try {
        const job = createWwpReminder(frequency ?? "", description ?? "", repeatAt ?? "");
        toast(`Reminder created: ${scheduleLabel(job.schedule)} (id ${job.id})`);
      } catch (e) {
        toast(`wwp:reminder failed: ${fail(e)}`);
      }
    },
  },
  {
    kind: "system",
    name: "wwp:list-reminders",
    aliases: [],
    title: "wwp:list-reminders",
    description: "List tasks and reminders (/wwp:list-reminders <reminders|today|all>)",
    path: "",
    handler: (args) => {
      const type = args.trim() || "all";
      void listWwpReminders(type).then(({ reminders, today }) => {
        const lines: string[] = [];
        if (reminders.length) {
          lines.push("Reminders:");
          for (const j of reminders) lines.push(`  ${j.id} — ${j.name} (${scheduleLabel(j.schedule)})`);
        }
        void listTodayTasks().then((todayTasks) => {
          if (today.length) {
            lines.push("Today's tasks:");
            for (const t of today) lines.push(`  ${t.id} — ${t.text}`);
          }
          toast(lines.length ? lines.join("\n") : "No reminders or tasks");
        });
      });
    },
  },
  {
    kind: "system",
    name: "wwp:rm-reminder",
    aliases: [],
    title: "wwp:rm-reminder",
    description: "Remove a reminder or today task (/wwp:rm-reminder <id>)",
    path: "",
    handler: (args) => {
      void removeWwpReminder(args.trim())
        .then(toast)
        .catch((e) => toast(`wwp:rm-reminder failed: ${fail(e)}`));
    },
  },
];
