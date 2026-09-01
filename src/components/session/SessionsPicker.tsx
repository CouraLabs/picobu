import { useEffect, useRef, useState } from "react";
import { useSelector } from "@xstate/store-react";
import type { SelectRenderable } from "@opentui/core";
import { loopStore } from "../../stores/loop-store";
import { themeStore } from "../../stores/theme-store";
import { useSessionBindings } from "../../providers/SessionBindings";
import { folderKeyFor, listSessions, type SessionRow } from "../../libs/sessions";
import { options } from "../../libs/options";

/** Compact relative age label, e.g. "5m", "3h", "2d". */
const relTime = (mtimeMs: number): string => {
  const min = Math.max(1, Math.round((Date.now() - mtimeMs) / 60_000));
  if (min < 60) return `${min}m`;
  if (min < 24 * 60) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / (24 * 60))}d`;
};

/**
 * Saved-session picker for the current folder (newest first). Picking a row
 * loads that session into the coding tab — the live one stays saved on disk.
 * Presentational like ModelPicker: the `select` renderable traps focus and
 * handles up/down/return; esc closes via useLoopKeybinds.
 */
export const SessionsPicker = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const { switchSession } = useSessionBindings();
  const selectRef = useRef<SelectRenderable>(null);
  const [rows, setRows] = useState<SessionRow[] | null>(null);

  useEffect(() => {
    void listSessions(folderKeyFor(options.app.cwd)).then(setRows);
  }, []);

  // Focus the select as soon as it actually renders (sessions load async, so
  // the select doesn't exist on the first mount) — this gives it the keyboard.
  useEffect(() => {
    if (!rows?.length) return;
    const id = setTimeout(() => selectRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [rows]);

  return (
    <box border borderStyle="single" title=" Sessions " titleColor={theme.text} borderColor={theme.border}>
      {rows === null ? (
        <text fg={theme.textMuted}>Loading sessions...</text>
      ) : rows.length === 0 ? (
        <text fg={theme.textMuted}>No saved sessions yet — a session is saved after its first prompt.</text>
      ) : (
        <select
          ref={selectRef}
          height={Math.min(rows.length, 5) * 2}
          showScrollIndicator
          options={rows.map((r) => ({
            name: `${r.id}  ·  ${relTime(r.mtimeMs)} ago`,
            description: r.firstPrompt,
            value: r.id,
          }))}
          selectedIndex={0}
          textColor={theme.text}
          focusedTextColor={theme.text}
          selectedTextColor={theme.selectedListItemText}
          descriptionColor={theme.textMuted}
          selectedDescriptionColor={theme.textMuted}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          selectedBackgroundColor="transparent"
          onSelect={(_index, option) => {
            if (option && typeof option.value === "string") {
              loopStore.trigger.closeSessionsPicker();
              switchSession(option.value);
            }
          }}
        />
      )}
    </box>
  );
};