import z from "zod";

export const AskOptionSchema = z.object({
  answer: z.string().min(1),
  answerDescription: z.string().optional().default(""),
});

export const AskQuestionSchema = z.object({
  title: z.string().min(1),
  question: z.string().min(1),
  type: z.enum(["multiple", "single"]),
  options: z.array(AskOptionSchema).min(1),
});

export const AskToolArgsSchema = z.object({
  questions: z.array(AskQuestionSchema).min(1).max(5),
});

export const AskToolOutputSchema = z.object({
  status: z.literal("pending"),
  message: z.string(),
});

/**
 * Interactive question flow tool. The loop is interrupted after this call
 * (`stopWhen: hasToolCall("ask")`), so the run pauses and the renderer shows
 * an uncollapsible form for each question (radio for `single`, checkboxes for
 * `multiple`, a custom free-text answer appended to every option list). Once
 * the user confirms, the answers are delivered back to the model as a
 * follow-up user prompt.
 */
export const createAskTool = () => ({
  name: "ask",
  kind: "flow" as const,
  description: [
    "Ask the user structured questions. The run pauses after this call and the user answers in the UI;",
    "each question has a radio (type 'single') or checkboxes (type 'multiple') with the answers you provide,",
    "and a final free-text field the UI appends automatically — never produce a custom option yourself.",
    "The answers are delivered back to you as a follow-up user message. Ask at most 5 questions per call.",
  ].join(" "),
  parameters: AskToolArgsSchema,
  output: AskToolOutputSchema,
  handler: (args: z.infer<typeof AskToolArgsSchema>): z.infer<typeof AskToolOutputSchema> => {
    if (!args.questions.length) throw new Error("ask requires at least one question");
    if (args.questions.length > 5) throw new Error("ask supports at most 5 questions per call");
    return {
      status: "pending",
      message: `Asked ${args.questions.length} question(s); awaiting user answers`,
    };
  },
});
