/**
 * Manual smoke test: run with `bun src/test.ts` (or `bun run dev:test`).
 *
 * Creates a session over the loop (with the configured `flash` role model),
 * subscribes to `session.stream()`, sends one random prompt, and prints the
 * status transitions, the streamed UI message chunks as they arrive, and the
 * final message list. Requires a configured model (`harness.defaultModel` or
 * the `flash` role in `~/.picobu/options.json`) and valid credentials.
 */
import { options, resolveModelRole, type ProviderModelReasoningEffort } from "@libs/options.ts";
import { createSession } from "@harness/agent/factory/loop/session.ts";

const prompts = [
  "Reply with exactly one word: ping",
  "Say hello in one short sentence.",
  "What is 2 + 2? Answer with the number only.",
  "Tell me a one-line fun fact.",
];

const prompt = "Glob the directory and read a random file. Then explain what you read." //prompts[Math.floor(Math.random() * prompts.length)]!;

let modelKey: string;
let thinking: ProviderModelReasoningEffort = "medium";
try {
  const role = resolveModelRole(options.harness, "flash");
  modelKey = role.modelKey;
  thinking = role.thinking ?? "medium";
} catch (error) {
  console.error("No model configured:", error);
  process.exit(1);
}

let lastStatus = "";
const session = await createSession(
  () => ({ agentId: "ask", modelKey, thinking }),
  {
    onChange: (state) => {
      if (state.status !== lastStatus) {
        lastStatus = state.status;
        console.log(`[status] ${state.status}`);
      }
    },
  },
);

console.log(`session:  ${session.id}`);
console.log(`model:    ${modelKey} (thinking: ${thinking})`);
console.log(`agent:    ${session.config.agentId}`);
console.log(`prompt:   ${prompt}\n`);

// Subscribe before sending: the generator yields every UIMessageChunk of the
// run and ends when the run settles.
const stream = session.streamMessages();
let chunkCount = 0;
let streaming = false;
const consume = (async () => {
  for await (const chunk of stream) {
    console.clear()
    console.log(chunk)
  }
})();

await session.sendMessage({ text: prompt });
await consume;
await session.flush();

if (streaming) {
  streaming = false;
  process.stdout.write("\n");
}

console.log(`\n--- messages (${session.messages.length}, ${chunkCount} chunks streamed) ---`);
console.log(`\n${JSON.stringify(session.messages, undefined, 2)}`);
console.log(`\n----`);
console.log(`\nusage: ${JSON.stringify(session.usage)}`);
process.exit(0);
