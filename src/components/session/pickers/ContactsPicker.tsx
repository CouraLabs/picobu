import { useEffect, useRef, useState } from "react";
import { useSelector } from "@xstate/store-react";
import type { SelectRenderable } from "@opentui/core";
import { loopStore } from "../../../stores/loop-store";
import { themeStore } from "../../../stores/theme-store";
import { useSessionBindings } from "../../../providers/SessionBindings";
import { listWwpContacts, type WwpContact } from "../../../integrations/whatsapp/contacts";
import { relTime } from "../../../libs/format";

/**
 * Known WhatsApp counterparties (newest activity first). Picking a row stages
 * `/wwp:msg <phone>|` into the prompt so the user only types the message.
 * Presentational like SessionsPicker: the `select` renderable traps focus and
 * handles up/down/return; esc closes via useLoopKeybinds.
 */
export const ContactsPicker = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const { insertPromptText } = useSessionBindings();
  const selectRef = useRef<SelectRenderable>(null);
  const [rows, setRows] = useState<WwpContact[] | null>(null);

  useEffect(() => {
    void listWwpContacts().then(setRows);
  }, []);

  // Focus the select as soon as contacts load (async, so it may not exist on
  // the first mount) — this hands it the keyboard.
  useEffect(() => {
    if (!rows?.length) return;
    const id = setTimeout(() => selectRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [rows]);

  return (
    <box border borderStyle="single" title=" WhatsApp contacts " titleColor={theme.text} borderColor={theme.border}>
      {rows === null ? (
        <text fg={theme.textMuted}>Loading contacts...</text>
      ) : rows.length === 0 ? (
        <text fg={theme.textMuted}>
          No contacts yet — your contact book syncs after WhatsApp connects (first sync can take a minute).
        </text>
      ) : (
        <select
          ref={selectRef}
          height={Math.min(rows.length, 5) * 2}
          showScrollIndicator
          options={rows.map((c) => ({
            name: c.name ?? `+${c.phone}`,
            description: `+${c.phone}  ·  last contact ${relTime(c.lastAt)} ago`,
            value: c.phone,
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
              insertPromptText(`/wwp:msg ${option.value}|`);
            }
          }}
        />
      )}
    </box>
  );
};
