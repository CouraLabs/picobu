import { useSelector } from "@xstate/store-react";
import { themeStore } from "../../../stores/theme-store";
import { CodeOutput } from "../CodeOutput";
import { ToolCallShell } from "./ToolCallShell";
import type { ToolStatus } from "../ToolCall";

export type WebfetchToolCallProps = {
  status: ToolStatus;
  url: string;
  contentType?: string;
  output?: string;
  /** Progress note streamed while the fetch is still running. */
  progress?: string;
  error?: string;
};

/** Webfetch tool renderer: header shows the requested URL, body shows the Markdown content. */
export const WebfetchToolCall = ({ url, status, output, error, contentType, progress, copyText }: WebfetchToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);

  return (
    <ToolCallShell
      name="Webfetch"
      status={status}
      error={error}
      copyText={copyText}
      header={(hovered) => (
        <>
          <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>{url}</text>
          {status === "running" && progress ? (
            <text selectable={false} fg={theme.textMuted}>{progress}</text>
          ) : contentType ? (
            <text selectable={false} fg={theme.textMuted}>{contentType}</text>
          ) : null}
        </>
      )}
    >
      <CodeOutput filetype="markdown" content={output ?? ""} />
    </ToolCallShell>
  );
};
