import { useEffect, useRef, useState } from "react";
import { useSelector } from "@xstate/store-react";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SelectRenderable } from "@opentui/core";
import { loopStore } from "../../../stores/loop-store";
import { themeStore } from "../../../stores/theme-store";
import { changeDirectory } from "../../../harness/commands/system/cd";
import { generateSessionId } from "../../../libs/sessions";
import { useSessionBindings } from "../../../providers/SessionBindings";
import { footerToastStore } from "../../../stores/footer-toast-store";

type DirEntryRow = { name: string; path: string };

/**
 * Directory-tree walker (`/cd` with no args). Starts at the current working
 * directory; `return` on a row walks into it, the leading `.` row confirms
 * the browsed directory as the new cwd, `..` goes up, esc closes untouched.
 * Presentational like ContactsPicker: the `select` renderable traps focus and
 * handles up/down/return; esc closes via useLoopKeybinds.
 */
export const DirectoryPicker = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const cwd = useSelector(loopStore, (s) => s.context.cwd);
  // Like the `/cd` command: a confirmed switch starts a fresh session (see the
  // command's doc comment for why).
  const { switchSession } = useSessionBindings();
  const selectRef = useRef<SelectRenderable>(null);
  const [path, setPath] = useState(cwd);
  const [rows, setRows] = useState<DirEntryRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readdir(path, { withFileTypes: true })
      .then((entries) => {
        if (cancelled) return;
        const dirs = entries
          .filter((e) => e.isDirectory() && !e.name.startsWith("."))
          .map((e) => ({ name: e.name, path: join(path, e.name) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setRows(dirs);
      })
      .catch(() => {
        if (cancelled) return;
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Focus the select as soon as the listing loads (async, so it may not exist
  // on the first mount) — this hands it the keyboard.
  useEffect(() => {
    if (rows === null) return;
    const id = setTimeout(() => selectRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [rows]);

  const confirm = (dir: string): void => {
    void changeDirectory(dir).then((error) => {
      if (error) footerToastStore.trigger.show({ message: error });
      else switchSession(generateSessionId());
      loopStore.trigger.closeCwdPicker();
    });
  };

  const options = [
    { name: ".", description: `change cwd to ${path}`, value: path },
    ...(dirname(path) !== path
      ? [{ name: "..", description: "up one directory", value: dirname(path) }]
      : []),
    ...(rows ?? []).map((r) => ({ name: r.name + "/", description: "", value: r.path })),
  ];

  return (
    <box
      border
      borderStyle="single"
      title={` cd — ${path} `}
      titleColor={theme.text}
      borderColor={theme.border}
    >
      {rows === null ? (
        <text fg={theme.textMuted}>Reading directories...</text>
      ) : (
        <select
          ref={selectRef}
          height={Math.min(options.length, 8) * 2}
          showScrollIndicator
          options={options}
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
            if (!option || typeof option.value !== "string") return;
            // `.` confirms the browsed directory; anything else walks into it.
            if (option.name === ".") confirm(option.value);
            else setPath(option.value);
          }}
        />
      )}
      <text fg={theme.textMuted}> return: enter dir · `.` row: set cwd · esc: cancel </text>
    </box>
  );
};
