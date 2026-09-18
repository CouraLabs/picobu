# Keyboard shortcuts and mouse

Shortcut actions fire when the key is **released**, so holding a key never repeats the action. Double-press chords use a 200ms window. On terminals that cannot report key releases (no Kitty keyboard protocol — e.g. Apple Terminal, tmux, Windows ConPTY), shortcuts transparently fall back to acting on key press. On Windows, ctrl+letter chords reported as alt+letter are also accepted.

The in-app help (`F1`) is the always-current source; it also lists your discovered skills, workflows, rules, and subagents.

## Keyboard

| Keys | Action |
| --- | --- |
| `F1` | Open / close help |
| `CTRL+D` `CTRL+D` / `F10` | Exit the app (double-press) |
| `ESC` | Close dialogs |
| `ESC` `ESC` | Interrupt: answer the flow first, move the newest queued prompt back to edit, then stop the run |
| `CTRL+U` / `F2` | Change model (same chord again closes the dialog) |
| `CTRL+K` / `F3` | Subagent jobs (same chord again closes the dialog) |
| `CTRL+W` / `F4` | Toggle steer mode (steer never clears the queue) |
| `SHIFT+TAB` | Cycle agent |
| `CTRL+E` | Cycle thinking effort |
| `CTRL+P` | Toggle sandbox (takes effect on the next run) |
| `CTRL+C` | Copy selected text |
| `CTRL+A` | Select all text in the prompt |
| `UP` / `DOWN` (command flyout) | Move the command highlight |
| `TAB` | Complete command (flyout open) or cycle prompt history (flyout closed) |

`CTRL+V` is intentionally not a keybinding: pasting into the prompt goes through its paste support, which reads the clipboard service — text is inserted at the cursor and images/PDFs attach as files.

## Mouse

| Action | Effect |
| --- | --- |
| Click the model chip (status bar) | Open the model picker |
| Hover the todo count | Preview the session todo list |
| Click a tool header | Collapse / expand its output (disabled when empty) |
| Double-click a message | Open Revert / Copy / Fork actions |
| Click a subagent row | Open its session |
| Drag-select text | Select, then `CTRL`/`CMD`+`C` copies; `ESC` clears the selection |

## See also

- [usage.md](usage.md) — slash commands and session flow
- [configuration/session-layout.md](configuration/session-layout.md) — what the status bar shows
