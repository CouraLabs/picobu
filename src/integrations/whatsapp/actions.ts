import { options } from "@config/options.ts";
import { sendText } from "@integrations/whatsapp/connection.ts";
import { normalizePhone } from "@integrations/whatsapp/phone.ts";
import { withLock } from "@shared/lock.ts";

export type TodayTask = { id: string; text: string; createdAt: number };
type TodayFile = { day: string; items: TodayTask[] };
export const whatsappFilePath = (name: string): string => `${options.app.systemDir}/whatsapp/${name}.json`;

const todayKey = (now = Date.now()): string => {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export const sendWwpMessage = async (phone: string, message: string): Promise<string> => {
  if (!normalizePhone(phone)) throw new Error(`Invalid phone number: ${phone}`);
  if (!message.trim()) throw new Error("Message text is empty");
  await sendText(phone, message);
  return `Message sent to +${normalizePhone(phone)}`;
};

export const addTodayTask = async (text: string): Promise<string> => {
  const path = whatsappFilePath("today");
  await withLock(path, async () => {
    const file = Bun.file(path);
    const current: TodayFile = (await file.exists()) ? ((await file.json()) as TodayFile) : { day: todayKey(), items: [] };
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
