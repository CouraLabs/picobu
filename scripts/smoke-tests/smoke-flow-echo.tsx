/**
 * Smoke test: settled ask/plan-write echoes render their message lines instead
 * of crashing on the Show accessor. Run: bun scripts/smoke-tests/smoke-flow-echo.tsx
 */
import { testRender } from "@opentui/solid"
import { AskForm } from "@tui/components/session/tools/ask-form.tsx"
import { PlanReview } from "@tui/components/session/tools/plan-review.tsx"

const question = {
  title: "Task",
  question: "What would you like help with?",
  type: "single" as const,
  options: [{ answer: "Build a new feature" }],
}

const renderFrame = async (node: () => unknown): Promise<string> => {
  const setup = await testRender(node as never, { width: 80, height: 30 })
  try {
    await setup.renderOnce()
    await setup.renderOnce()
    return setup.captureCharFrame()
  } finally {
    setup.renderer.destroy()
  }
}

let failed = false
const check = (label: string, frame: string, needles: string[]) => {
  const missing = needles.filter((n) => !frame.includes(n))
  if (missing.length > 0) {
    failed = true
    console.log(`FAIL: ${label} (missing: ${missing.join(", ")})`)
  } else {
    console.log(`PASS: ${label}`)
  }
}

const askFrame = await renderFrame(() => (
  <AskForm
    questions={[question]}
    status="answered"
    outputMessage={"Task: Build a new feature\nsecond line"}
    interactive={false}
    onConfirm={() => {}}
    onCancel={() => {}}
  />
))
check("answered ask echo", askFrame, ["Task: Build a new feature", "second line"])

const planFrame = await renderFrame(() => (
  <PlanReview
    plan={"step one\nstep two"}
    status="approved"
    outputMessage={"looks good\nship it"}
    interactive={false}
    onVerdict={() => {}}
    onCancel={() => {}}
  />
))
check("approved plan echo", planFrame, ["Approved", "looks good", "ship it"])

process.exit(failed ? 1 : 0)
