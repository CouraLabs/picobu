import { createStore } from "@xstate/store-react";
import { mkdirSync } from "node:fs";
import { options } from "../libs/options";
import { withLock } from "../libs/lock";
import { footerToastStore } from "../stores/footer-toast-store";
import { isDue, type CronJob } from "./schedule";
import { deliverCronAction } from "../integrations/whatsapp/deliver";

const SWEEP_MS = 30_000;

/** Persisted cron jobs file: `~/.picobu/crons.json`. */
type CronFile = { jobs: CronJob[] };

export const newCronId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export type CronStoreState = { jobs: CronJob[] };

export const cronsFilePath = (): string => `${options.app.systemDir}/crons.json`;

/** Live cron jobs backing the scheduler and the Crons tab. */
export const cronStore = createStore({
  context: { jobs: [] as CronJob[] },
  on: {
    /** Replace the whole list (after load or a locked mutation). */
    set: (_s, e: { jobs: CronJob[] }) => ({ jobs: e.jobs }),
  },
});

/** Read the jobs file without touching the store (callers that mutate go through the API). */
export const readCrons = async (): Promise<CronJob[]> => {
  const file = Bun.file(cronsFilePath());
  if (!(await file.exists())) return [];
  try {
    const parsed = (await file.json()) as { jobs?: CronJob[] };
    return Array.isArray(parsed.jobs) ? parsed.jobs : [];
  } catch {
    return [];
  }
};

/** Write jobs to disk (caller holds the file lock). */
async function persistJobsRaw(jobs: CronJob[]): Promise<void> {
  mkdirSync(options.app.systemDir, { recursive: true });
  await Bun.write(cronsFilePath(), JSON.stringify({ jobs }, null, 2));
}

/** Read-modify-write the job list under the file lock, then mirror the result into the store. */
const mutate = async (fn: (jobs: CronJob[]) => CronJob[]): Promise<CronJob[]> => {
  const jobs = await withLock(cronsFilePath(), async () => {
    const jobs = fn(await readCrons());
    mkdirSync(options.app.systemDir, { recursive: true });
    await Bun.write(cronsFilePath(), JSON.stringify({ jobs }, null, 2));
    return jobs;
  });
  cronStore.trigger.set({ jobs });
  return jobs;
};

/** Load persisted jobs into the store; call once at startup. */
export const loadCrons = async (): Promise<CronJob[]> => {
  const jobs = await readCrons();
  cronStore.trigger.set({ jobs });
  return jobs;
};

/** Insert or replace a job (persisted under a file lock). */
export const upsertCron = (job: CronJob): Promise<CronJob[]> =>
  mutate((jobs) => [...jobs.filter((j) => j.id !== job.id), job]);

/** Remove a job by id; returns the removed job or undefined. */
export const removeCron = async (id: string): Promise<CronJob | undefined> => {
  let removed: CronJob | undefined;
  await mutate((jobs) => {
    const found = jobs.find((j) => j.id === id);
    removed = found;
    return jobs.filter((j) => j.id !== id);
  });
  return removed;
};

/** Enable/disable a job by id. */
export const setCronEnabled = (id: string, enabled: boolean): Promise<CronJob[]> =>
  mutate((jobs) => jobs.map((j) => (j.id === id ? { ...j, enabled } : j)));

/** Persist bookkeeping for a job that just executed (file + store). */
const markFired = async (id: string, at: number): Promise<void> => {
  await mutate((jobs) =>
    jobs.map((j) => (j.id === id ? { ...j, lastRunAt: at, runCount: j.runCount + 1 } : j)),
  );
};

/** Execute one job. Errors are reported per job, never thrown out of the sweep. */
async function executeJob(job: CronJob): Promise<void> {
  try {
    await deliverCronAction(job.action);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    footerToastStore.trigger.show({ message: `Cron "${job.name}" failed: ${message}` });
    return;
  }
  await markFired(job.id, Date.now());
}

/** One scheduler pass: fire every due job (sequential, best-effort). */
export const tickCrons = async (now = Date.now()): Promise<void> => {
  const jobs = await readCrons();
  const due = jobs.filter((j) => isDue(j, now));
  for (const job of due) await executeJob(job);
};

let schedulerTimer: ReturnType<typeof setInterval> | undefined;

/** Start the in-app scheduler: a 30s sweep that evaluates every job while the app is open. */
export function startCronScheduler(): void {
  if (schedulerTimer) return;
  void loadCrons();
  schedulerTimer = setInterval(() => {
    void tickCrons().catch(() => {});
  }, SWEEP_MS);
}


