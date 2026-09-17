#!/usr/bin/env bash
# picobu installer: clones the repo, installs deps, and compiles a standalone
# binary to ~/.picobu/bin/picobu. Rerunning updates via a fresh re-clone.
set -euo pipefail

REPO_URL="https://github.com/CouraLabs/picobu.git"
PICOBU_HOME="$HOME/.picobu"
SOURCE_DIR="$PICOBU_HOME/source"
CLONE_DIR="$SOURCE_DIR/picobu"
BIN_DIR="$PICOBU_HOME/bin"
BIN_PATH="$BIN_DIR/picobu"

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

command -v git >/dev/null 2>&1 || fail "git is required. Install it with one of:
  winget install --id Git.Git        (Windows)
  brew install git                   (macOS)
  sudo apt-get install git           (Debian/Ubuntu)"

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

printf '%s\n' ""
printf '%s\n' "${DIM}Installing${NC} picobu ${DIM}→${NC} $BIN_PATH"
printf '%s\n' ""

ensure_bun

run "Preparing $PICOBU_HOME"
mkdir -p "$SOURCE_DIR" "$BIN_DIR"

if [ -d "$CLONE_DIR" ]; then
  run "Removing previous clone"
  rm -rf "$CLONE_DIR"
fi

run "Cloning $REPO_URL"
git clone -q --depth 1 "$REPO_URL" "$CLONE_DIR" || fail "git clone failed"
cd "$CLONE_DIR"

PICOBU_VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
[ -n "$PICOBU_VERSION" ] || fail "could not read version from package.json"

run "Installing dependencies"
INSTALL_OUT="$(mktemp)"
if ! bun install --os="*" --cpu="*" --no-cache --no-save --trust >"$INSTALL_OUT" 2>&1; then
  dump <"$INSTALL_OUT"
  rm -f "$INSTALL_OUT"
  fail "bun install failed"
fi
PKG_COUNT="$(grep -o '[0-9]* packages installed' "$INSTALL_OUT" | head -1 | cut -d' ' -f1)"
rm -f "$INSTALL_OUT"
if [ -n "$PKG_COUNT" ]; then
  ok "Dependencies installed ($PKG_COUNT packages)"
else
  ok "Dependencies installed"
fi

run "Compiling binary"
BUILD_OUT="$(mktemp)"
if ! bun scripts/build.ts --out-dir "$BIN_DIR" --quiet >"$BUILD_OUT" 2>&1; then
  dump <"$BUILD_OUT"
  rm -f "$BUILD_OUT"
  fail "compile failed"
fi
rm -f "$BUILD_OUT"
[ -f "$BIN_PATH" ] || fail "compile did not produce $BIN_PATH"
chmod +x "$BIN_PATH"
ok "Binary compiled ($BIN_PATH, $(du -h "$BIN_PATH" | cut -f1))"

run "Smoke test (--version)"
SMOKE_DIR="$(mktemp -d)"
if ! (cd "$SMOKE_DIR" && "$BIN_PATH" --version >/dev/null 2>&1); then
  rm -rf "$SMOKE_DIR"
  fail "smoke test failed: $BIN_PATH --version did not run cleanly"
fi
rm -rf "$SMOKE_DIR"
ok "picobu $("$BIN_PATH" --version 2>/dev/null | head -1) runs cleanly"

# PATH wiring: append to the rc of the login shell, guarded against duplicates.
PICOBU_PATH_LINE='export PATH="$HOME/.picobu/bin:$PATH"'
append_line_to_rc() {
  local rc="$1" line="$2"
  if [ ! -f "$rc" ]; then
    return 1
  fi
  if grep -qsF "$line" "$rc"; then
    ok "PATH already configured in $rc"
    return 0
  fi
  printf '\n%s\n' "$line" >>"$rc"
  ok "PATH updated in $rc"
  return 0
}

export PATH="$BIN_DIR:$PATH"
RC_DONE=0
case "$(basename "${SHELL:-}")" in
  zsh)
    append_line_to_rc "$HOME/.zshrc" "$PICOBU_PATH_LINE" && RC_DONE=1
    ;;
  bash)
    if [ "$(uname -s)" = "Darwin" ]; then
      append_line_to_rc "$HOME/.bash_profile" "$PICOBU_PATH_LINE" || append_line_to_rc "$HOME/.bashrc" "$PICOBU_PATH_LINE"
      RC_DONE=1
    else
      append_line_to_rc "$HOME/.bashrc" "$PICOBU_PATH_LINE" && RC_DONE=1
    fi
    ;;
  fish)
    append_line_to_rc "$HOME/.config/fish/config.fish" 'fish_add_path "$HOME/.picobu/bin"' && RC_DONE=1
    ;;
esac
if [ "$RC_DONE" -eq 0 ]; then
  note "could not detect a supported shell rc; add this to your shell config:"
  note "  export PATH=\"\$HOME/.picobu/bin:\$PATH\""
fi

printf '%s\n' ""
printf '%s\n' "${DIM}┌╦═══╦┐┌═╤╦╤═┐┌╦═══╦┐┌╦═══╦┐┌╦══╦┐ ┌╦   ╦┐${NC}"
printf '%s\n' "${DIM}│╠═══╩┘  │║│  │║     │║   ║││╠══╩╗┐│║   ║│${NC}"
printf '%s\n' "${DIM}└╩     └═╧╩╧═┘└╩═══╩┘└╩═══╩┘└╩═══╩┘└╩═══╩┘${NC}"
printf '%s\n' ""
printf '%s\n' "  picobu ${PICOBU_VERSION} installed"
printf '%s\n' ""
printf '%s\n' "  cd <project>"
printf '%s\n' "  picobu"
printf '%s\n' ""
note "open a new shell or run: export PATH=\"\$HOME/.picobu/bin:\$PATH\""
note "rerun this installer to update picobu (fresh re-clone + recompile)"
printf '%s\n' ""
