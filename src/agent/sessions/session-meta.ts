import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { z } from "zod";
import { options } from "@config/options.ts";
import { withLock } from "@shared/lock.ts";






export type SessionState = "waiting" | "finished" | "error" | "running";


export const BLOCKING_FLOW_TOOLS: readonly string[] = ["ask", "plan-write"];
type LooseToolPart = {
  type: string;
  toolName?: unknown;
  output?: unknown;
};


export function isWaiting(messages: { role: string; parts: unknown[] }[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return false;
  return last.parts.some((raw) => {
    const part = raw as LooseToolPart;
    if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-")) return false;
    const name = part.type === "dynamic-tool" ? String(part.toolName ?? "") : part.type.slice("tool-".length);
    if (!BLOCKING_FLOW_TOOLS.includes(name)) return false;
    const output = part.output;
    return typeof output === "object" && output !== null && (output as { status?: unknown }).status === "pending";
  });
}






export type CostDetail = {
  source: "run" | "subagent";
  sessionId?: string;
  subagent?: string;
  modelKey?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost?: number;
  inputCost?: number;
  outputCost?: number;
  cacheCost?: number;
};


export type CostDetails = {
  totalCost?: number;
  inputCost?: number;
  outputCost?: number;
  cacheCost?: number;
  details: CostDetail[];
};


export type SessionTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost?: number;
  costDetails: CostDetails;
};
export const emptyTotals = (): SessionTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costDetails: { details: [] },
});


export function addToTotals(totals: SessionTotals, detail: CostDetail): SessionTotals {
  const costDetails: CostDetails = {
    ...totals.costDetails,
    details: [...totals.costDetails.details, detail],
  };
  if (detail.cost !== undefined) {
    costDetails.totalCost = (costDetails.totalCost ?? 0) + detail.cost;
    if (detail.inputCost !== undefined) costDetails.inputCost = (costDetails.inputCost ?? 0) + detail.inputCost;
    if (detail.outputCost !== undefined) costDetails.outputCost = (costDetails.outputCost ?? 0) + detail.outputCost;
    if (detail.cacheCost !== undefined) costDetails.cacheCost = (costDetails.cacheCost ?? 0) + detail.cacheCost;
  }
  return {
    inputTokens: totals.inputTokens + detail.inputTokens,
    outputTokens: totals.outputTokens + detail.outputTokens,
    cacheReadTokens: totals.cacheReadTokens + detail.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens + detail.cacheWriteTokens,
    cost: detail.cost !== undefined ? (totals.cost ?? 0) + detail.cost : totals.cost,
    costDetails,
  };
}





const totalsSchema: z.ZodType<SessionTotals> = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  cost: z.number().optional(),
  costDetails: z.object({
    totalCost: z.number().optional(),
    inputCost: z.number().optional(),
    outputCost: z.number().optional(),
    cacheCost: z.number().optional(),
    details: z.array(z.any()),
  }),
});
const metaSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  state: z.enum(["waiting", "finished", "error", "running"]),
  parentSessionId: z.string().optional(),
  cwd: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  modelKey: z.string().optional(),
  totals: totalsSchema.optional(),
});


export type SessionMeta = z.infer<typeof metaSchema>;
const sessionsRoot = (): string => join(options.app.systemDir, "sessions");


export const sessionMetaPath = (folderKey: string, sessionId: string): string =>
  join(sessionsRoot(), folderKey, `${sessionId}.meta.json`);


export async function readSessionMeta(folderKey: string, sessionId: string): Promise<SessionMeta | null> {
  let raw: string;
  try {
    raw = await readFile(sessionMetaPath(folderKey, sessionId), "utf8");
  } catch {
    return null;
  }
  try {
    return metaSchema.parse(JSON.parse(raw));
  } catch {
    return null; 
  }
}


export async function writeSessionMeta(folderKey: string, sessionId: string, meta: SessionMeta): Promise<void> {
  const path = sessionMetaPath(folderKey, sessionId);
  await withLock(path, async () => {
    mkdirSync(join(sessionsRoot(), folderKey), { recursive: true });
    await writeFile(path, `${JSON.stringify(meta, null, 2)}\n`);
  });
}


export async function updateSessionMeta(
  folderKey: string,
  sessionId: string,
  patch: Partial<Omit<SessionMeta, "id">>,
): Promise<SessionMeta | null> {
  const path = sessionMetaPath(folderKey, sessionId);
  return withLock(path, async () => {
    let current: SessionMeta | null = null;
    try {
      current = metaSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch {
      return null; 
    }
    const next: SessionMeta = { ...current, ...patch, id: sessionId, updatedAt: Date.now() };
    mkdirSync(join(sessionsRoot(), folderKey), { recursive: true });
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  });
}
export async function deleteSessionMeta(folderKey: string, sessionId: string): Promise<void> {
  try {
    await rm(sessionMetaPath(folderKey, sessionId), { force: true });
  } catch {
  }
}


export async function recoverSessionMeta(folderKey: string, sessionId: string): Promise<SessionMeta | null> {
  const meta = await readSessionMeta(folderKey, sessionId);
  if (!meta || meta.state !== "running") return meta;
  return updateSessionMeta(folderKey, sessionId, { state: "error" });
}
