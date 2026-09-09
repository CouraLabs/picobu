/**
 * Temporary smoke test: renders tool parts through ToolPart with a mock
 * session and prints a captured char frame. Run: bun scripts/smoke-tool-part.tsx
 */
import { testRender } from "@opentui/solid"
import { SessionMessages } from "@tui/components/session/session-messages.tsx"
import type { LoopMessage } from "@agent/loop/create-loop.ts"

const messages: LoopMessage[] = [
  {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: "read the file and run tests" }],
  } as LoopMessage,
  {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "tool-read", state: "input-streaming", input: { path: "src/a/b.ts" } },
      { type: "tool-read", state: "output-available", input: { path: "src/a/b.ts", fromLine: 1, toLine: 20 }, output: { filetype: "ts", content: "const x = 1" } },
      { type: "tool-shell", state: "output-error", input: { command: "bun test" }, errorText: "command `bun test` exited 1\n2 failures" },
      { type: "dynamic-tool", toolName: "remote-ping", state: "output-available", input: { host: "example.com" }, output: { status: "ok" } },
      { type: "tool-websearch", state: "output-available", input: { query: "bun test opentui" }, output: "some very long output line that should be truncated somewhere around the limit of two hundred characters so we keep typing to exceed it ................. end" },
      { type: "tool-websearch", state: "output-available", preliminary: true, input: { query: "iphone 18" }, output: { progress: "Fetching results 5–8 of 10…", results: [{ title: "t", url: "u", snippet: "s", content: null }] } },
      { type: "tool-webfetch", state: "output-available", preliminary: true, input: { url: "https://example.com" }, output: { progress: "Rendering in headless Chrome…" } },
      { type: "tool-ask", state: "input-available", input: { questions: [{ title: "Pick one", question: "Which?", type: "single", options: [{ answer: "a" }] }] } },
      { type: "tool-edit", state: "output-available", input: { path: "src/a/b.ts", oldString: "a", newString: "b" }, output: { diff: "diff --git a/src/a/b.ts b/src/a/b.ts\n--- a/src/a/b.ts\n+++ b/src/a/b.ts\n@@ -1,2 +1,3 @@\n context line\n-removed line\n+added line\n+another added line\n" } },
      { type: "tool-write", state: "output-available", input: { path: "src/new.ts", contents: "const y = 2\nconst z = 3" }, output: { message: "Wrote src/new.ts (2 lines)", content: "const y = 2\nconst z = 3" } },
      { type: "tool-todo", state: "output-available", input: { actionType: "upd", action: { index: 1, item: { phase: "implement", title: "Stream shell output", prompt: "", done: false } } }, output: { items: [
        { phase: "setup", title: "Add streaming spawn", prompt: "", done: true },
        { phase: "setup", title: "Wire progress chunks", prompt: "", done: true },
        { phase: "implement", title: "Stream shell output", prompt: "", done: false },
        { phase: "implement", title: "Smoke test the TUI", prompt: "", done: false },
      ], message: "todo #1 updated" } },
      { type: "text", text: "All done." },
    ],
  } as unknown as LoopMessage,
]

const testSetup = await testRender(
  () => <SessionMessages messages={messages} />,
  { width: 60, height: 20 },
)
const { renderOnce, captureCharFrame, renderer } = testSetup

try {
  await renderOnce()
  console.log(captureCharFrame())
} finally {
  // The renderer owns native timers; without destroy() the process never exits.
  renderer.destroy()
}
process.exit(0)
