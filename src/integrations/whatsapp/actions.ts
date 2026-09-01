import {
  parseTimeOfDay,
  parseFrequency,
  scheduleLabel,
  type CronJob,
} from "../../cron/schedule";
import { newCronId, upsertCron, removeCron, readCrons } from "../../cron/cron-store";
import { withLock } from "../../libs/lock";
import { options } from "../../libs/options";
import { sendText } from "./connection";
import { normalizePhone } from "./phone";

/** Persisted "today" task: `~/.picobu/whatsapp/today.json`, reset each day. */
export type TodayTask = { id: string; text: string; createdAt: number };

type TodayFile = { day: string; items: TodayTask[] };

export const whatsappFilePath = (name: string): string =>
  `${options.app.systemDir}/whatsapp/${name}.json`;

/** Local day key (`2026-1-9`) used to reset the today list. */
const todayKey = (now = Date.now()): string => {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** Send a WhatsApp text; throws with a user-facing message on failure. */
export const sendWwpMessage = async (phone: string, message: string): Promise<string> => {
  if (!normalizePhone(phone)) throw new Error(`Invalid phone number: ${phone}`);
  if (!message.trim()) throw new Error("Message text is empty");
  await sendText(phone, message);
  return `Message sent to +${normalizePhone(phone)}`;
};

/** Create an alert cron job: fires a WhatsApp message at `timeOfDay` daily. */
export const createWwpAlert = (
  phone: string,
  message: string,
  level: number,
  timeOfDay: string,
): CronJob => {
  if (!normalizePhone(phone)) throw new Error(`Invalid phone number: ${phone}`);
  if (!message.trim()) throw new Error("Alert message is empty");
  if (!parseTimeOfDay(timeOfDay)) throw new Error(`Invalid time of day: ${timeOfDay} (use HH:MM)`);
  const levelNum = Math.max(1, Math.floor(level) || 1);
  const job: CronJob = {
    id: newCronId(),
    name: `Alert to +${normalizePhone(phone)}: ${message.trim().slice(0, 40)}`,
    origin: "alert",
    enabled: true,
    createdAt: Date.now(),
    schedule: { type: "daily", time: timeOfDay.trim() },
    action: { type: "whatsapp", phone, message, level: levelNum },
    lastRunAt: 0,
    runCount: 0,
  };
  void upsertCron(job);
  return job;
};

/** List active alerts (origin === "alert"). */
export const listWwpAlerts = async (): Promise<CronJob[]> =>
  (await readCrons()).filter((j) => j.origin === "alert");

/** Remove an alert by id; throws when the id is unknown. */
export const removeWwpAlert = async (id: string): Promise<string> => {
  const removed = await removeCron(id);
  if (!removed) throw new Error(`No alert with id ${id}`);
  return `Alert ${id} removed`;
};

/** Append a task to today's list (file resets when the day changes). */
export const addTodayTask = async (text: string): Promise<string> => {
  const path = whatsappFilePath("today");
  await withLock(path, async () => {
    const file = Bun.file(path);
    const current: TodayFile = (await file.exists())
      ? ((await file.json()) as TodayFile)
      : { day: todayKey(), items: [] };
    const items = current.day === todayKey() ? current.items : [];
    const task: TodayTask = {
      id: `t${Date.now().toString(36)}`,
      text: text.trim(),
      createdAt: Date.now(),
    };
    const next: TodayFile = { day: todayKey(), items: [...items, task] };
    await Bun.write(path, JSON.stringify(next, null, 2));
  });
  return `Added to today's tasks: ${text}`;
};

/** Today's tasks (empty list once the day rolls over). */
export const listTodayTasks = async (): Promise<TodayTask[]> => {
  const file = Bun.file(whatsappFilePath("today"));
  if (!(await file.exists())) return [];
  try {
    const parsed = (await file.json()) as TodayFile;
    return parsed.day === todayKey() ? parsed.items : [];
  } catch {
    return [];
  }
};

/** Remove a today-task by id; throws when unknown. */
export const removeTodayTask = async (id: string): Promise<string> => {
  const path = whatsappFilePath("today");
  await withLock(path, async () => {
    const file = Bun.file(path);
    if (!(await file.exists())) throw new Error(`No task with id ${id}`);
    const parsed = (await file.json()) as TodayFile;
    const before = parsed.day === todayKey() ? parsed.items : [];
    const items = before.filter((t) => t.id !== id);
    if (items.length === before.length) throw new Error(`No task with id ${id}`);
    await Bun.write(path, JSON.stringify({ day: todayKey(), items }, null, 2));
  });
  return `Task ${id} removed`;
};

/** Create a recurring reminder cron job fired over WhatsApp. */
export const createWwpReminder = (
  frequency: string,
  description: string,
  repeatAtTime: string,
): CronJob => {
  if (!description.trim()) throw new Error("Reminder description is empty");
  // An explicit HH:MM anchor wins; otherwise treat `frequency` as an interval.
  if (parseTimeOfDay(repeatAtTime)) {
    const job = reminderJob(`Reminder: ${description.trim().slice(0, 40)}`, {
      type: "daily",
      time: repeatAtTime.trim(),
    });
    void upsertCron(job);
    return job;
  }
  const minutes = parseFrequency(frequency);
  if (!minutes) {
    throw new Error(
      `Invalid frequency: ${frequency} (use e.g. "daily", "hourly", "every 30m", or an HH:MM anchor)`,
    );
  }
  const job = reminderJob(
    `Reminder: ${description.trim().slice(0, 40)}`,
    { type: "interval", everyMinutes: minutes },
  );
  void upsertCron(job);
  return job;
};

const reminderJob = (name: string, schedule: CronJob["schedule"]): CronJob => ({
  id: newCronId(),
  name,
  origin: "reminder",
  enabled: true,
  createdAt: Date.now(),
  schedule,
  action: { type: "notification", message: name },
  lastRunAt: 0,
  runCount: 0,
});

/** List reminders (origin === "reminder") and today's tasks. */
export const listWwpReminders = async (
  type: string,
): Promise<{ reminders: CronJob[]; today: TodayTask[] }> => {
  const kind = type.trim().toLowerCase();
  const reminderJobs = (await readCrons()).filter((j) => j.origin === "reminder");
  if (kind === "reminders") return { today: [], reminders: reminderJobs };
  if (kind === "today") return { reminders: [], today: await listTodayTasks() };
  return { reminders: reminderJobs, today: await listTodayTasks() };
};

/** Remove a reminder cron job (or today-task) by id. */
export const removeWwpReminder = async (id: string): Promise<string> => {
  if (id.startsWith("t")) return removeTodayTask(id);
  const removed = await removeCron(id);
  if (!removed) throw new Error(`No reminder with id ${id}`);
  return `Reminder ${id} removed`;
};



