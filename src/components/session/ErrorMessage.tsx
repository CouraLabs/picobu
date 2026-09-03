import { TextAttributes } from "@opentui/core";
import { icons } from "../symbols/icons";
import { useTheme } from "../../hooks/useTheme";
import type { ErrorReport } from "../../libs/error-report";

/** Error line shown where the run settled with a provider/transport failure —
 * the counterpart of `ThinkingIndicator` for the non-streaming error state.
 * The bold message is the summary; the dim block under it carries the
 * technical detail (status, URL, response body, cause). */
export const ErrorMessage = ({ report }: { report: ErrorReport }) => {
  const { theme } = useTheme();
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1}>
        <text selectable={false} fg={theme.error}>{icons.cross}</text>
        <text fg={theme.error} attributes={TextAttributes.BOLD}>{report.message}</text>
      </box>
      {report.detail ? (
        <box flexDirection="row" gap={1}>
          <text selectable={false} fg={theme.error}>{icons.prompt}</text>
          <text fg={theme.error} attributes={TextAttributes.DIM}>{report.detail}</text>
        </box>
      ) : null}
    </box>
  );
};
