import { useEffect, useRef, useState, type RefObject } from "react";
import { useSelector } from "@xstate/store-react";
import { TextAttributes, type InputRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { Button } from "../../ui/Button";
import { icons } from "../../symbols/icons";
import { interactionStore, type AskAnswer, type AskQuestion } from "../../../stores/interaction-store";
import { themeStore } from "../../../stores/theme-store";
import { MarqueeText } from "../../ui/MarqueeText";
import { ToolCallShell } from "./ToolCallShell";
import { useSession } from "../../../hooks/useSession";
import { useSessionBindings } from "../../../providers/SessionBindings";
import type { ToolStatus } from "../ToolCall";

export type AskToolCallProps = {
  status: ToolStatus;
  error?: string;
  questions: AskQuestion[];
  partKey: string;
  isPending: boolean;
  hasFollowingUserMessage: boolean;
};

/** The UI appends a "custom answer" option past every model-provided option. */
const customIndex = (q: AskQuestion): number => q.options.length;

/** Width of a question tab's inner title (box `paddingX` eats 2 more). */
const TAB_TITLE_WIDTH = 14;

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * Chrome around the question title line, in cells: app `paddingX` (4), the
 * tool body's left border + `paddingX` (3), and one safety cell.
 */
const QUESTION_CHROME = 8;

/** Resolve selected option indices + custom text into renderable/sendable answers. */
const answerFor = (
  q: AskQuestion,
  chosen: number[],
  custom: string,
): { selections: string[]; custom?: string } => {
  const ci = customIndex(q);
  const hasCustom = chosen.includes(ci);
  const selections = chosen
    .filter((i) => i !== ci)
    .map((i) => q.options[i]?.answer ?? "")
    .filter((s) => s.length > 0);
  if (q.type === "single") {
    if (hasCustom) return custom.trim() ? { selections: [], custom: custom.trim() } : { selections: [] };
    return { selections };
  }
  return hasCustom && custom.trim() ? { selections, custom: custom.trim() } : { selections };
};

const buildSummaryText = (answers: AskAnswer[]): string => {
  const lines = ["[The user answered your questions]"];
  answers.forEach((a, i) => {
    lines.push(`${i + 1}. ${a.title} — ${a.question}`);
    a.selections.forEach((s) => lines.push(`  - ${s}`));
    if (a.custom) lines.push(`  - Custom: ${a.custom}`);
  });
  return lines.join("\n");
};

/**
 * Interactive ask tool renderer. Pinned open (uncollapsible, non-copyable).
 * Each question is a tab (title → question → clickable radio/checkbox rows +
 * a custom free-text option); the last tab summarizes everything and sends the
 * answers as a new prompt once the user confirms.
 */
export const AskToolCall = ({ questions, status, error, partKey, isPending, hasFollowingUserMessage, copyText }: AskToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const { sessionId } = useSessionBindings();
  const { streaming, onPrompt } = useSession();
  const answered = useSelector(interactionStore, (s) => s.context.answeredAsk[sessionId]?.[partKey]);
  const [activeTab, setActiveTab] = useState(0);
  const [picks, setPicks] = useState<Record<number, number[]>>({});
  const [customs, setCustoms] = useState<Record<number, string>>({});
  const [hover, setHover] = useState<string | null>(null);
  const customInputRef = useRef<InputRenderable | null>(null);

  const interactive = isPending && !hasFollowingUserMessage && !answered && !streaming;

  // Focus the custom-answer input right after it becomes visible.
  useEffect(() => {
    if (!interactive || activeTab >= questions.length) return;
    const q = questions[activeTab];
    if (!q) return;
    if ((picks[activeTab] ?? []).includes(customIndex(q))) {
      const id = setTimeout(() => customInputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [interactive, activeTab, picks, questions]);

  const toggle = (qi: number, idx: number) => {
    const q = questions[qi];
    if (!q) return;
    setPicks((prev) => {
      const cur = new Set(prev[qi] ?? []);
      if (q.type === "single") {
        return { ...prev, [qi]: cur.has(idx) ? [] : [idx] };
      }
      const next = new Set(cur);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return { ...prev, [qi]: [...next] };
    });
  };

  const confirmAnswers = () => {
    if (!sessionId) return;
    const answers: AskAnswer[] = questions.map((q, qi) => {
      const r = answerFor(q, picks[qi] ?? [], customs[qi] ?? "");
      return { title: q.title, question: q.question, type: q.type, selections: r.selections, ...(r.custom ? { custom: r.custom } : {}) };
    });
    const summaryText = buildSummaryText(answers);
    interactionStore.trigger.markAskAnswered({ sessionId, partKey, answers, summaryText });
    onPrompt(summaryText);
  };

  const allDone = questions.every((q, qi) => {
    const r = answerFor(q, picks[qi] ?? [], customs[qi] ?? "");
    return r.selections.length > 0 || Boolean(r.custom);
  });

  return (
    <ToolCallShell
      name="Ask"
      status={status}
      error={error}
      copyText={copyText}
      defaultCollapsed={false}
      collapsible={false}
      copyable={!interactive}
      header={(hovered) => (
        <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>
          {interactive ? `${questions.length} question(s) · awaiting answers` : `${questions.length} question(s)`}
        </text>
      )}
    >
      {interactive ? (
        <box flexDirection="column">
          <box id="ask-tabs" flexDirection="row" gap={1}>
            {questions.map((q, qi) => (
              <box
                key={`tab-${qi}`}
                onMouseDown={() => setActiveTab(qi)}
                onMouseOver={() => setHover(`tab-${qi}`)}
                onMouseOut={() => setHover(null)}
                border={["bottom"]}
                borderColor={activeTab === qi ? theme.accent : theme.textMuted}
                paddingX={1}
              >
                <MarqueeText
                  text={q.title}
                  width={TAB_TITLE_WIDTH}
                  attributes={activeTab === qi ? TextAttributes.BOLD : TextAttributes.DIM}
                  fg={hover === `tab-${qi}` ? theme.accent : activeTab === qi ? theme.text : theme.textMuted}
                />
              </box>
            ))}
            <box
              key="tab-answers"
              onMouseDown={() => setActiveTab(questions.length)}
              onMouseOver={() => setHover("tab-answers")}
              onMouseOut={() => setHover(null)}
              border={["bottom"]}
              borderColor={activeTab === questions.length ? theme.accent : theme.textMuted}
              paddingX={1}
            >
              <text
                selectable={false}
                attributes={activeTab === questions.length ? TextAttributes.BOLD : TextAttributes.DIM}
                fg={hover === "tab-answers" ? theme.accent : activeTab === questions.length ? theme.text : theme.textMuted}
              >
                Answers
              </text>
            </box>
          </box>

          {activeTab < questions.length ? (
            <QuestionBody
              q={questions[activeTab]!}
              chosen={picks[activeTab] ?? []}
              custom={customs[activeTab] ?? ""}
              hover={hover}
              theme={theme}
              onToggle={(idx) => toggle(activeTab, idx)}
              onCustom={(v) => setCustoms((c) => ({ ...c, [activeTab]: v }))}
              inputRef={customInputRef}
              setHover={setHover}
            />
          ) : (
            <box key="answers-panel" flexDirection="column">
              <text selectable={false} fg={theme.text} attributes={TextAttributes.BOLD}>
                Answers
              </text>
              {questions.map((q, qi) => {
                const r = answerFor(q, picks[qi] ?? [], customs[qi] ?? "");
                const done = r.selections.length > 0 || Boolean(r.custom);
                return (
                  <box key={`ans-${qi}`} flexDirection="column">
                    <text selectable={false} attributes={TextAttributes.BOLD} fg={done ? theme.text : theme.error}>
                      {`${qi + 1}. ${q.title}`}
                    </text>
                    {done ? (
                      <>
                        {r.selections.map((s, si) => (
                          <text key={`o-${si}`} selectable={false} fg={theme.textMuted}>
                            {`  - ${s}`}
                          </text>
                        ))}
                        {r.custom && (
                          <text selectable={false} fg={theme.textMuted}>
                            {`  - Custom: ${r.custom}`}
                          </text>
                        )}
                      </>
                    ) : (
                      <text selectable={false} fg={theme.error}>
                        {"  (missing)"}
                      </text>
                    )}
                  </box>
                );
              })}
              <box flexDirection="row" gap={1}>
                {allDone ? (
                  <Button bordered={false} variant="success" onPress={confirmAnswers}>
                    Send answers
                  </Button>
                ) : (
                  <text selectable={false} fg={theme.error}>
                    Answer all questions to send
                  </text>
                )}
              </box>
            </box>
          )}
        </box>
      ) : answered ? (
        <box flexDirection="column" gap={0}>
          {answered.summaryText.split("\n").map((l, i) => (
            <text key={i} selectable={false} fg={theme.textMuted}>
              {l}
            </text>
          ))}
        </box>
      ) : (
        <box flexDirection="column" gap={0}>
          {questions.map((q, qi) => (
            <text key={qi} selectable={false} fg={theme.textMuted}>
              {`${qi + 1}. ${q.title} — ${q.question}`}
            </text>
          ))}
          {hasFollowingUserMessage && (
            <text selectable={false} fg={theme.textMuted}>
              {"— answers in the following message"}
            </text>
          )}
        </box>
      )}
    </ToolCallShell>
  );
};

type QuestionBodyProps = {
  q: AskQuestion;
  chosen: number[];
  custom: string;
  hover: string | null;
  theme: ReturnType<typeof themeStore.getSnapshot>["context"]["theme"];
  onToggle: (idx: number) => void;
  onCustom: (v: string) => void;
  inputRef: RefObject<InputRenderable | null>;
  setHover: (hover: string | null) => void;
};

const QuestionBody = ({ q, chosen, custom, hover, theme, onToggle, onCustom, inputRef, setHover }: QuestionBodyProps) => {
  const dims = useTerminalDimensions();
  const ci = customIndex(q);
  const marker = (idx: number): string => {
    const active = chosen.includes(idx);
    if (q.type === "single") return active ? "(•)" : "( )";
    return active ? "[x]" : "[ ]";
  };

  return (
    <box key={`q-${q.title}`} flexDirection="column">
      <MarqueeText
        text={`${q.title} - ${q.question}`}
        width={Math.max(8, dims.width - QUESTION_CHROME)}
        fg={theme.text}
        attributes={TextAttributes.BOLD}
      />
      {q.options.map((opt, oi) => (
        <box
          key={`opt-${oi}`}
          flexDirection="row"
          gap={1}
          width="100%"
          backgroundColor={hover === `opt-${oi}` ? theme.backgroundElement : "transparent"}
          onMouseDown={() => onToggle(oi)}
          onMouseOver={() => setHover(`opt-${oi}`)}
          onMouseOut={() => setHover(null)}
        >
          <text selectable={false} fg={chosen.includes(oi) ? theme.accent : theme.textMuted}>
            {marker(oi)}
          </text>
          <text selectable={false} fg={chosen.includes(oi) ? theme.text : theme.textMuted}>
            {opt.answer}
          </text>
        </box>
      ))}
      <box
        key="opt-custom"
        flexDirection="row"
        gap={1}
        width="100%"
        backgroundColor={hover === "opt-custom" ? theme.backgroundElement : "transparent"}
        onMouseDown={() => {
          onToggle(ci);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        onMouseOver={() => setHover("opt-custom")}
        onMouseOut={() => setHover(null)}
      >
        <text selectable={false} fg={chosen.includes(ci) ? theme.accent : theme.textMuted}>
          {q.type === "single" ? (chosen.includes(ci) ? "(•)" : "( )") : chosen.includes(ci) ? "[x]" : "[ ]"}
          {" " + icons.edit}
        </text>
        <text selectable={false} fg={chosen.includes(ci) ? theme.text : theme.textMuted}>
          Custom answer
        </text>
      </box>
      {chosen.includes(ci) && (
        <box flexDirection="column" gap={0} paddingLeft={1}>
          <text selectable={false} fg={theme.textMuted} attributes={TextAttributes.DIM}>
            {`${icons.edit} Your answer (${clip(q.question, 60)})`}
          </text>
          <input
            ref={inputRef}
            value={custom}
            placeholder="Type a custom answer…"
            maxLength={500}
            textColor={theme.text}
            placeholderColor={theme.textMuted}
            backgroundColor="transparent"
            focusedBackgroundColor={theme.backgroundElement}
            onInput={onCustom}
          />
        </box>
      )}
    </box>
  );
};