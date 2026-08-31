import { useSelector } from "@xstate/store-react";
import { TextAttributes } from "@opentui/core";
import { themeStore } from "../../../stores/theme-store";
import { ScrollableOutput } from "../ScrollableOutput";
import { ToolCallShell } from "../ToolCallShell";
import type { ToolStatus } from "../ToolCall";

export type WebsearchResultItem = {
  title: string;
  url: string;
  snippet: string;
  content: string | null;
};

export type WebsearchToolCallProps = {
  status: ToolStatus;
  query: string;
  deepness?: number;
  results: WebsearchResultItem[];
  error?: string;
};

/**
 * Websearch tool renderer: header shows the query, body lists each result with
 * its title, URL, and snippet (fetched page content is omitted — it lives in
 * the model's context, not the UI).
 */
export const WebsearchToolCall = ({ query, deepness, results, status, error, copyText }: WebsearchToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const fetchedCount = results.filter((r) => r.content !== null).length;

  return (
    <ToolCallShell
      name="Websearch"
      status={status}
      error={error}
      copyText={copyText}
      header={(hovered) => (
        <>
          <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>
            {deepness && deepness > 1 ? `"${query}" (${deepness} pages)` : `"${query}"`}
          </text>
          <text selectable={false} fg={theme.textMuted}>
            {`${fetchedCount}/${results.length} pages fetched`}
          </text>
        </>
      )}
    >
      <ScrollableOutput>
        <box flexDirection="column">
          {results.length === 0 ? (
            <text selectable={false} fg={theme.textMuted}>No results</text>
          ) : null}
          {results.map((result, index) => (
            <box key={`${result.url}-${index}`} flexDirection="column">
              <text selectable={false} fg={theme.text} attributes={TextAttributes.BOLD}>
                {`${index + 1}. ${result.title}`}
              </text>
              <text selectable={false} fg={theme.accent}>{result.url}</text>
              {result.snippet ? (
                <text selectable={false} fg={theme.textMuted}>{result.snippet}</text>
              ) : null}
            </box>
          ))}
        </box>
      </ScrollableOutput>
    </ToolCallShell>
  );
};
