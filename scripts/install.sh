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

log() { printf '%s\n' "==> $*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || fail "git is required. Install it with one of:
  winget install --id Git.Git        (Windows)
  brew install git                   (macOS)
  sudo apt-get install git           (Debian/Ubuntu)"

ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    return
  fi
  if [ -x "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
    return
  fi
  log "bun not found; installing via https://bun.sh"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  command -v bun >/dev/null 2>&1 || fail "bun installation did not produce a bun on PATH; install manually from https://bun.sh"
}

ensure_bun

log "creating $PICOBU_HOME"
mkdir -p "$SOURCE_DIR" "$BIN_DIR"

if [ -d "$CLONE_DIR" ]; then
  log "removing existing clone at $CLONE_DIR"
  rm -rf "$CLONE_DIR"
fi

log "cloning $REPO_URL into $CLONE_DIR"
git clone --depth 1 "$REPO_URL" "$CLONE_DIR"
cd "$CLONE_DIR"

log "installing dependencies"
bun install --os="*" --cpu="*" --no-cache --no-save --trust

log "compiling binary to $BIN_PATH"
bun build --compile src/cli.ts --outfile "$BIN_PATH"

[ -f "$BIN_PATH" ] || fail "compile did not produce $BIN_PATH"
chmod +x "$BIN_PATH"

# PATH wiring: append to the rc of the login shell, guarded against duplicates.
PICOBU_PATH_LINE='export PATH="$HOME/.picobu/bin:$PATH"'
append_line_to_rc() {
  local rc="$1" line="$2"
  if [ ! -f "$rc" ]; then
    return 1
  fi
  if grep -qsF "$line" "$rc"; then
    return 0
  fi
  printf '\n%s\n' "$line" >>"$rc"
  log "appended PATH entry to $rc"
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
  log "could not detect a supported shell rc; add this to your shell config:"
  log '  export PATH="$HOME/.picobu/bin:$PATH"'
fi

printf '\n'
log "picobu installed: $BIN_PATH"
if command -v picobu >/dev/null 2>&1; then
  log "run 'picobu' to start (current shell already has it on PATH)"
else
  log "open a new shell or run:  export PATH=\"\$HOME/.picobu/bin:\$PATH\""
fi
log "rerun this installer anytime to update picobu (fresh re-clone + recompile)"
