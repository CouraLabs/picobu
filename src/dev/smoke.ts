import { options, resolveModelRole, type ProviderModelReasoningEffort } from "@config/options.ts";
import { createSession } from "@agent/sessions/session.ts";
const prompt = "Glob the directory and read a random file. Then explain what you read."
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
const session = await createSession({
  config: () => ({ agentId: "ask", modelKey, thinking }),
  onChange: (state) => {
    if (state.status !== lastStatus) {
      lastStatus = state.status;
      console.log(`[status] ${state.status}`);
    }
  },
});
console.log(`session:  ${session.id}`);
console.log(`model:    ${modelKey} (thinking: ${thinking})`);
console.log(`agent:    ${session.config.agentId}`);
console.log(`prompt:   ${prompt}\n`);

const stream = session.streamMessages();
let chunkCount = 0;
let streaming = false;
const consume = (async () => {
  for await (const chunk of stream) {
    chunkCount++;
    console.clear()
    console.log(chunk)
  }
})();
let sendError: unknown = undefined;
try {
  await session.sendMessage({ text: prompt });
} catch (error) {
  sendError = error;
  try {
    await stream.cancel();
  } catch {
  }
}
await consume;
if (sendError) {
  console.error("sendMessage failed:", sendError);
  process.exit(1);
}
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
