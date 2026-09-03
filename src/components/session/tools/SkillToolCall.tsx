import { useSelector } from "@xstate/store-react";
import { TextAttributes } from "@opentui/core";
import { themeStore } from "../../../stores/theme-store";
import { CodeOutput } from "../CodeOutput";
import { ToolCallShell } from "./ToolCallShell";
import { clip } from "../../../libs/format";
import type { ToolStatus } from "../ToolCall";

export type SkillToolCallProps = {
  status: ToolStatus;
  /** The requested skill name (input). */
  skill: string;
  description?: string;
  skillDir?: string;
  files?: string[];
  content?: string;
  error?: string;
};

/** Rows of related files shown in the body before clipping to "+N more". */
const MAX_FILE_ROWS = 20;

/**
 * Skill tool renderer: header shows the skill name and how many related files
 * the skill folder carries; the body shows the description and the loaded
 * SKILL.md content (collapsed by default, like Read).
 */
export const SkillToolCall = ({
  skill,
  description,
  skillDir,
  files,
  content,
  status,
  error,
  copyText,
}: SkillToolCallProps & { copyText: string }) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const fileCount = files?.length ?? 0;

  return (
    <ToolCallShell
      name="Skill"
      status={status}
      error={error}
      copyText={copyText}
      header={(hovered) => (
        <text selectable={false} fg={hovered ? theme.accent : theme.textMuted}>
          {`${skill} · ${fileCount} file${fileCount === 1 ? "" : "s"}`}
        </text>
      )}
    >
      <box flexDirection="column">
        {description && (
          <text selectable={false} fg={theme.textMuted}>{clip(description, 200)}</text>
        )}
        {content && <CodeOutput filetype="markdown" content={content} />}
        {skillDir && !!fileCount && (
          <box flexDirection="column">
            <text selectable={false} fg={theme.text} attributes={TextAttributes.BOLD}>
              {skillDir}
            </text>
            {files!.slice(0, MAX_FILE_ROWS).map((file) => (
              <text key={file} selectable={false} fg={theme.textMuted}>
                {`  ${file}`}
              </text>
            ))}
            {fileCount > MAX_FILE_ROWS && (
              <text selectable={false} fg={theme.textMuted}>
                {`  +${fileCount - MAX_FILE_ROWS} more`}
              </text>
            )}
          </box>
        )}
      </box>
    </ToolCallShell>
  );
};
