#!/usr/bin/env bash
# picobu installer: installs Bun when missing, then installs the published
# @couralabs/picobu npm package globally via `bun add -g`. Rerunning updates
# to the pinned version (override with PICOBU_VERSION=latest).
set -euo pipefail

PACKAGE_NAME='@couralabs/picobu'
# stamped by scripts/publish.ts — do not edit by hand
PICOBU_VERSION_DEFAULT="1.30.4"
PUPPETEER_VERSION_DEFAULT="25.10.0"
PICOBU_VERSION="${PICOBU_VERSION:-$PICOBU_VERSION_DEFAULT}"
PICOBU_HOME="$HOME/.picobu"
LEGACY_BIN="$PICOBU_HOME/bin/picobu"
LEGACY_PATH_LINE='export PATH="$HOME/.picobu/bin:$PATH"'
LEGACY_FISH_LINE='fish_add_path "$HOME/.picobu/bin"'
BUN_BIN="${BUN_INSTALL:-$HOME/.bun}/bin"
PUPPETEER_CACHE="${PUPPETEER_CACHE_DIR:-$HOME/.cache/puppeteer}"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  DIM=$'\033[2m'
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  NC=$'\033[0m'
else
  DIM=''
  RED=''
  GREEN=''
  NC=''
fi

fail() { printf '%s\n' "${RED}error:${NC} $*" >&2; exit 1; }
run()  { printf '%s\n' "  ${DIM}·${NC} $*"; }
ok()   { printf '%s\n' "  ${GREEN}✓${NC} $*"; }
note() { printf '%s\n' "  ${DIM}${*}${NC}"; }
dump() { while IFS= read -r line; do printf '%s\n' "${DIM}  |${NC} ${line}"; done; }

ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    run "Bun $(bun --version)"
    return
  fi
  if [ -x "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
    run "Bun $(bun --version)"
    return
  fi
  run "Installing Bun via https://bun.sh"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  command -v bun >/dev/null 2>&1 || fail "bun installation did not produce a bun on PATH; install manually from https://bun.sh"
  run "Bun $(bun --version)"
}

remove_legacy_path() {
  local rc="$1" line="$2"
  [ -f "$rc" ] || return 0
  local tmp
  tmp="$(mktemp)"
  grep -vF "$line" "$rc" >"$tmp" || true
  if ! cmp -s "$rc" "$tmp"; then
    cat "$tmp" >"$rc"
    ok "removed legacy PATH entry from $rc"
  fi
  rm -f "$tmp"
}

printf '%s\n' ""
printf '%s\n' "${DIM}Installing${NC} picobu ${DIM}→${NC} global bun package $PACKAGE_NAME@$PICOBU_VERSION"
printf '%s\n' ""

ensure_bun

remove_legacy_path "$HOME/.zshrc" "$LEGACY_PATH_LINE"
remove_legacy_path "$HOME/.bash_profile" "$LEGACY_PATH_LINE"
remove_legacy_path "$HOME/.bashrc" "$LEGACY_PATH_LINE"
remove_legacy_path "$HOME/.config/fish/config.fish" "$LEGACY_FISH_LINE"

if [ -f "$LEGACY_BIN" ]; then
  rm -f "$LEGACY_BIN"
  ok "removed legacy compiled binary"
fi

run "Installing $PACKAGE_NAME@$PICOBU_VERSION"
INSTALL_OUT="$(mktemp)"
if ! bun add -g "$PACKAGE_NAME@$PICOBU_VERSION" --trust >"$INSTALL_OUT" 2>&1; then
  dump <"$INSTALL_OUT"
  rm -f "$INSTALL_OUT"
  fail "bun add -g failed"
fi
rm -f "$INSTALL_OUT"
ok "Package installed"

export PATH="$BUN_BIN:$PATH"
CLI_PATH="$(command -v picobu || true)"
if [ -z "$CLI_PATH" ] && [ -x "$BUN_BIN/picobu" ]; then
  CLI_PATH="$BUN_BIN/picobu"
fi
if [ -z "$CLI_PATH" ]; then
  fail "picobu was installed but is not on PATH. Add it with:
  export PATH=\"$BUN_BIN:\$PATH\""
fi

run "Smoke test (--version)"
SMOKE_DIR="$(mktemp -d)"
if ! (cd "$SMOKE_DIR" && "$CLI_PATH" --version >/dev/null 2>&1); then
  rm -rf "$SMOKE_DIR"
  fail "smoke test failed: picobu --version did not run cleanly"
fi
rm -rf "$SMOKE_DIR"
PICOBU_VERSION="$("$CLI_PATH" --version 2>/dev/null | head -1)"
ok "picobu $PICOBU_VERSION installed"

# PATH wiring for buns not installed via bun.sh (brew, npm): their users have
# no ~/.bun/bin rc entry, but `bun add -g` always shims into $BUN_BIN.
ensure_bun_bin_on_path() {
  case ":$PATH:" in
    *":$BUN_BIN:"*) return 0 ;;
  esac
  local line="export PATH=\"$BUN_BIN:\$PATH\""
  local rc
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
    [ -f "$rc" ] || continue
    if grep -qsF "$line" "$rc"; then
      export PATH="$BUN_BIN:$PATH"
      return 0
    fi
  done
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
    if [ -f "$rc" ]; then
      printf '\n%s\n' "export PATH=\"$BUN_BIN:\$PATH\"" >>"$rc"
      ok "PATH updated in $rc"
      export PATH="$BUN_BIN:$PATH"
      return 0
    fi
  done
  note "could not wire PATH automatically; add this to your shell config:"
  note "  export PATH=\"$BUN_BIN:\$PATH\""
}
ensure_bun_bin_on_path

if [ ! -d "$PUPPETEER_CACHE" ] || [ -z "$(ls -A "$PUPPETEER_CACHE" 2>/dev/null || true)" ]; then
  run "Provisioning Chrome for the web tool"
  if ! bunx "puppeteer@$PUPPETEER_VERSION_DEFAULT" browsers install chrome >/dev/null 2>&1; then
    fail "chrome provisioning failed (puppeteer browsers install chrome)"
  fi
  ok "Chrome provisioned"
fi

printf '%s\n' ""
printf '%s\n' "${DIM}┌╦═══╦┐┌═╤╦╤═┐┌╦═══╦┐┌╦═══╦┐┌╦══╦┐ ┌╦   ╦┐${NC}"
printf '%s\n' "${DIM}│╠═══╩┘  │║│  │║     │║   ║││╠══╩╗┐│║   ║│${NC}"
printf '%s\n' "${DIM}└╩     └═╧╩╧═┘└╩═══╩┘└╩═══╩┘└╩═══╩┘└╩═══╩┘${NC}"
printf '%s\n' ""
printf '%s\n' "  picobu $PICOBU_VERSION installed"
printf '%s\n' ""
printf '%s\n' "  cd <project>"
printf '%s\n' "  picobu"
printf '%s\n' ""
note "open a new shell if picobu is not found"
note "update with: bun update -g $PACKAGE_NAME"
note "or rerun this installer (pins $PICOBU_VERSION; PICOBU_VERSION=latest tracks the newest release)"
note "uninstall: curl -fsSL https://raw.githubusercontent.com/CouraLabs/picobu/refs/heads/master/scripts/uninstall.sh | bash"
printf '%s\n' ""
