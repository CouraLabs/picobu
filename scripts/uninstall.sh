#!/usr/bin/env bash
# picobu uninstaller: removes the global @couralabs/picobu npm package, deletes
# ~/.picobu entirely (sessions, settings, OAuth credentials), and strips the
# legacy ~/.picobu/bin PATH entry added by older install.sh versions.
set -euo pipefail

PACKAGE_NAME='@couralabs/picobu'
PICOBU_HOME="$HOME/.picobu"

if command -v bun >/dev/null 2>&1; then
  if bun remove -g "$PACKAGE_NAME" 2>/dev/null; then
    echo "==> removed the global $PACKAGE_NAME package"
  else
    echo "==> note: bun remove -g $PACKAGE_NAME failed (was picobu installed via bun?)"
  fi
else
  echo "==> note: bun not found; skipping global package removal"
fi

if [ -d "$PICOBU_HOME" ]; then
  echo "==> deleting $PICOBU_HOME"
  echo "    (sessions, options.json, auth.json, WhatsApp auth)"
  rm -rf "$PICOBU_HOME"
else
  echo "==> $PICOBU_HOME not found; nothing to delete"
fi

# Remove the PATH lines older install.sh versions appended to shell rc files
# (exact match only; never touches user lines that merely mention .picobu).
remove_from_rc() {
  local rc="$1" line="$2"
  [ -f "$rc" ] || return 0
  local tmp
  tmp="$(mktemp)"
  grep -vF "$line" "$rc" >"$tmp" || true
  if ! cmp -s "$rc" "$tmp"; then
    cat "$tmp" >"$rc"
    echo "==> removed picobu PATH entry from $rc"
  fi
  rm -f "$tmp"
}

PICOBU_PATH_LINE='export PATH="$HOME/.picobu/bin:$PATH"'
remove_from_rc "$HOME/.zshrc" "$PICOBU_PATH_LINE"
remove_from_rc "$HOME/.bash_profile" "$PICOBU_PATH_LINE"
remove_from_rc "$HOME/.bashrc" "$PICOBU_PATH_LINE"
remove_from_rc "$HOME/.config/fish/config.fish" 'fish_add_path "$HOME/.picobu/bin"'

echo "==> picobu uninstalled; open a new shell so PATH changes take effect"
echo "==> note: the puppeteer Chrome cache in ${PUPPETEER_CACHE_DIR:-$HOME/.cache/puppeteer} is shared with other tools and was left in place"
