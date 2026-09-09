/**
 * Temporary smoke test: drives the AskForm end to end — select options, add a
 * comment, open the summary tab, confirm — and prints the emitted answers text.
 * Run: bun scripts/smoke-ask-form.tsx
 */
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { AskForm } from "@tui/components/session/tools/ask-form.tsx"
import type { AskQuestionView } from "@tui/components/session/tools/tool-summary.ts"

const questions: AskQuestionView[] = [
  {
    title: "Pick one",
    question: "Which?",
    type: "single",
    options: [{ answer: "a" }, { answer: "b" }],
  },
  {
    title: "Which ones",
    question: "Check any.",
    type: "multiple",
    options: [{ answer: "x", answerDescription: "first" }, { answer: "y" }],
  },
]

const App = () => {
  const [answersText, setAnswersText] = createSignal("(nothing yet)")
  return (
    <box flexDirection="column">
      <AskForm questions={questions} onConfirm={setAnswersText} />
      <text>EMITTED: {answersText()}</text>
    </box>
  )
}

const { renderOnce, captureCharFrame, mockMouse, mockInput, renderer } = await testRender(() => <App />, {
  width: 70,
  height: 30,
})

  await renderOnce()

  try {
    // Radio: clicking "a" then "b" must keep only one selection.
  await mockMouse.click(2, 4)
  await mockMouse.click(2, 5)
  await renderOnce()
  console.log("--- radio: clicked a then b (expect only b selected) ---")
  console.log(captureCharFrame())

  // Add a comment, switch to question 2, pick both checkboxes, then confirm.
  await mockMouse.click(5, 7)
  mockInput.typeText("extra note")
  await renderOnce()
  console.log("--- after typing comment ---")
  console.log(captureCharFrame())
  await mockMouse.click(14, 1)
  await renderOnce()
  console.log("--- question 2 tab (comment + multiple) ---")
  console.log(captureCharFrame())
  await mockMouse.click(2, 4)
  await mockMouse.click(2, 5)
  await mockMouse.click(27, 1)
  await renderOnce()
  console.log("--- summary tab ---")
  console.log(captureCharFrame())
  await mockMouse.click(5, 10)
  await renderOnce()
  console.log("--- after confirm ---")
  console.log(captureCharFrame())
} finally {
  renderer.destroy()
}
process.exit(0)
