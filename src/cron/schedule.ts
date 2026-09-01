/** Pure cron-schedule types + evaluation (no I/O — unit-testable). */

export type CronAction =
  | { type: "whatsapp"; phone: string; message: string; /** Intrusiveness level (1+). */ level?: number }
  | { type: "notification"; message: string }
  | { type: "prompt"; text: string };

/** Where a job came from: a /wwp:alert, a /wwp:reminder, or a user cron. */
export type CronOrigin = "alert" | "reminder" | "cron";

export type CronSchedule =
  | { type: "daily"; /** Local `HH:MM` fire time. */ time: string }
  | { type: "interval"; /** Minutes between fires. */ everyMinutes: number };

export type CronJob = {
  id: string;
  /** Human-readable name shown in the Crons tab. */
  name: string;
  origin: CronOrigin;
  enabled: boolean;
  createdAt: number;
  schedule: CronSchedule;
  action: CronAction;
  /** Epoch ms of the most recent fire (0 = never). */
  lastRunAt: number;
  /** How many times this job has fired. */
  runCount: number;
};

const MINUTE_MS = 60_000;

/** Parse a reminder frequency into minutes: "30m", "every 2h", "daily", "hourly". */
export const parseFrequency = (frequency: string): number | null => {
  const f = frequency.trim().toLowerCase();
  if (!f) return null;
  if (f === "hourly") return 60;
  if (f === "daily" || f === "everyday" || f === "every day") return 24 * 60;
  if (f === "weekly") return 7 * 24 * 60;
  const m = /^every\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/.exec(f);
  if (!m?.[1] || !m[2]) {
    // bare form: "30m", "2h", "1d"
    const plain = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/.exec(f);
    if (!plain?.[1] || !plain[2]) return null;
    const n = Number(plain[1]);
    if (n <= 0) return null;
    if (plain[2].startsWith("h")) return n * 60;
    if (plain[2].startsWith("d")) return n * 24 * 60;
    return n;
  }
  const n = Number(m[1]);
  if (n <= 0) return null;
  if (m[2]?.startsWith("h")) return n * 60;
  if (m[2].startsWith("d")) return n * 24 * 60;
  return n;
};

/** Parse `HH:MM` (24h) into `{ hours, minutes }`; null when malformed. */
export const parseTimeOfDay = (value: string): { hours: number; minutes: number } | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m?.[1] || !m[2]) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
};

/** Epoch ms of today's `HH:MM` local fire time. */
const todayAt = (now: number, time: { hours: number; minutes: number }): number => {
  const d = new Date(now);
  d.setHours(time.hours, time.minutes, 0, 0);
  return d.getTime();
};

/**
 * True when `job` is due at `now`. Interval jobs fire once `everyMinutes`
 * have elapsed since the last run (creation is the first anchor). Daily jobs
 * fire once the clock has reached their `HH:MM` time and they have not
 * already fired today.
 */
export const isDue = (job: CronJob, now: number): boolean => {
  if (!job.enabled) return false;
  if (job.schedule.type === "interval") {
    const anchor = job.lastRunAt > 0 ? job.lastRunAt : job.createdAt;
    return now - anchor >= job.schedule.everyMinutes * MINUTE_MS;
  }
  const tod = parseTimeOfDay(job.schedule.time);
  if (!tod) return false;
  const fireAt = todayAt(now, tod);
  if (now < fireAt) return false;
  // Already fired today? (a lastRun from a previous day still counts as due)
  const last = new Date(job.lastRunAt || 0);
  const today = new Date(now);
  return !(
    last.getFullYear() === today.getFullYear() &&
    last.getMonth() === today.getMonth() &&
    last.getDate() === today.getDate()
  );
};

/** Human label for a schedule: `daily at 09:30` / `every 30m`. */
export const scheduleLabel = (schedule: CronJob["schedule"]): string =>
  schedule.type === "daily" ? `daily at ${schedule.time}` : `every ${schedule.everyMinutes}m`;

/** One-line job summary used by toasts and the Crons tab. */
export const cronJobSummary = (job: CronJob): string =>
  `${job.name} (${scheduleLabel(job.schedule)}) — ${
    job.action.type === "whatsapp" ? `WhatsApp to ${job.action.phone}` : job.action.type
  }${job.enabled ? "" : " [disabled]"}`;

/** Local `YYYY-MM-DD HH:mm` used in UI listings. */
export const formatLocalTime = (epochMs: number): string => {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
};
