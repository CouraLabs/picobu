import { useEffect, useRef, useState } from "react";
import { useSelector } from "@xstate/store-react";
import { readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { SelectRenderable } from "@opentui/core";
import { loopStore } from "../../../stores/loop-store";
import { themeStore } from "../../../stores/theme-store";
import { useSessionBindings } from "../../../providers/SessionBindings";

type PickerRow = { name: string; path: string; isDir: boolean };

/**
 * File-tree walker (ctrl+t): pick a file to link it into the prompt as an
 * accent-colored `@<relative-path>` token at the cursor. `return` on a
 * directory walks into it, `..` goes up, esc closes. Presentational like
 * ContactsPicker: the `select` renderable traps focus and handles
 * up/down/return; esc closes via useLoopKeybinds.
 */
export const FilePicker = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const cwd = useSelector(loopStore, (s) => s.context.cwd);
  const { insertPromptLink } = useSessionBindings();
  const selectRef = useRef<SelectRenderable>(null);
  const [path, setPath] = useState(cwd);
  const [rows, setRows] = useState<PickerRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readdir(path, { withFileTypes: true })
      .then((entries) => {
        if (cancelled) return;
        const list = entries
          .filter((e) => !e.name.startsWith("."))
          .filter((e) => e.isDirectory() || e.isFile())
          .map((e) => ({ name: e.name, path: join(path, e.name), isDir: e.isDirectory() }))
          .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
        setRows(list);
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

  const link = (filePath: string): void => {
    insertPromptLink(relative(cwd, filePath));
    loopStore.trigger.closeFilePicker();
  };

  const parent = dirname(path);
  const dirPaths = new Map<string, boolean>([
    ...(parent !== path ? [[parent, true] as const] : []),
    ...(rows ?? []).map((r) => [r.path, r.isDir] as const),
  ]);
  const options = [
    ...(parent !== path
      ? [{ name: "..", description: "up one directory", value: parent }]
      : []),
    ...(rows ?? []).map((r) => ({
      name: (r.isDir ? r.name + "/" : r.name),
      description: "",
      value: r.path,
    })),
  ];

  return (
    <box border borderStyle="single" title={` Link file — ${path} `} titleColor={theme.text} borderColor={theme.border}>
      {rows === null ? (
        <text fg={theme.textMuted}>Reading files...</text>
      ) : options.length === 0 ? (
        <text fg={theme.textMuted}>No files here.</text>
      ) : (
        <select
          ref={selectRef}
          height={Math.min(options.length, 8)}
          showScrollIndicator
          options={options}
          selectedIndex={0}
          textColor={theme.text}
          focusedTextColor={theme.text}
          selectedTextColor={theme.accent}
          descriptionColor={theme.textMuted}
          selectedDescriptionColor={theme.textMuted}
          showDescription={false}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          selectedBackgroundColor={theme.backgroundElement}
          onSelect={(_index, option) => {
            if (!option || typeof option.value !== "string") return;
            if (dirPaths.get(option.value)) setPath(option.value);
            else link(option.value);
          }}
        />
      )}
      <text fg={theme.textMuted}> return: walk / link · esc: cancel </text>
    </box>
  );
};
