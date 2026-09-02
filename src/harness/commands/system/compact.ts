import type { Command } from "../types";
import { compactionStore } from "../../../stores/compaction-store";

/**
 * `/compact` — manually compact the current session into a summary and move to
 * a fresh session. The command only signals (`compactionStore`); the mounted
 * SessionProvider owns the messages and runs the compaction pipeline. Requires
 * idle: compaction summarizes the settled conversation, so a mid-run request
 * would either race the stream or summarize a truncated transcript.
 */
export const compact: Command = {
  kind: "system",
  name: "compact",
  aliases: [],
  flags: ["code"],
  requiresIdle: true,
  title: "compact",
  description: "Compacts this session into a summary (continues in a new session)",
  path: "",
  handler: () => {
    compactionStore.trigger.request();
  },
};
