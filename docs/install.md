# Installation

## Requirements

- [Bun](https://bun.sh) ≥ 1.x
- A terminal font with current programmer-glyph coverage (e.g. an up-to-date Source Code Pro, JetBrains Mono, or equivalent Nerd Fonts coverage) — the TUI status icons assume it
- A model: an API key (any `@opencode-ai/models` provider `env` var, e.g. `HYPER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GITHUB_TOKEN`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`) or an OAuth login — see [configuration/providers.md](configuration/providers.md)

## From source

```sh
git clone https://github.com/CouraLabs/picobu.git
cd picobu
bun install
bun dev
```

## npm install

Installs Bun when missing, then installs the published `@couralabs/picobu` package globally via `bun add -g`; the `picobu` shim lands in `~/.bun/bin` (`%USERPROFILE%\.bun\bin` on Windows), which the installer wires onto your PATH when needed.

```sh
curl -fsSL https://raw.githubusercontent.com/CouraLabs/picobu/refs/heads/master/scripts/install.sh | bash
```

On Windows (PowerShell):

```powershell
powershell -c "irm https://raw.githubusercontent.com/CouraLabs/picobu/refs/heads/master/scripts/install.ps1|iex"
```

The installers pin the release they shipped with; set `PICOBU_VERSION=latest` to track the newest release. Updates: `bun update -g @couralabs/picobu`. One-shot without installing: `bunx @couralabs/picobu`.

The web tools (`webfetch`/`websearch`) need Puppeteer's Chrome; the installers provision it automatically (skipped when the shared cache in `~/.cache/puppeteer` is already populated), and `bun install` handles it for source installs.

## Uninstall

Removes the global `@couralabs/picobu` package, then deletes `~/.picobu` entirely — sessions, settings, and OAuth credentials — and strips any legacy `~/.picobu/bin` PATH entry:

```sh
curl -fsSL https://raw.githubusercontent.com/CouraLabs/picobu/refs/heads/master/scripts/uninstall.sh | bash
```

Or from a clone: `scripts/uninstall.sh` (`scripts/uninstall.ps1` on Windows). The Puppeteer Chrome cache is shared with other tools and is left in place.

## Verifying a checkout

```sh
bun run lint
bun run tsc
bun test tests/<dir>/<file>.test.ts
```

Smoke tests need a real model configured in `~/.picobu/options.json`: `bun run src/dev/smoke.ts`. Unit tests need no real keys (fake model keys, tmp dirs).

## Troubleshooting installs

- **`picobu: command not found` after the installer finishes** — the shim lives in `~/.bun/bin`; open a new shell or add `export PATH="$HOME/.bun/bin:$PATH"` to your shell rc.
- **`bun add -g` fails with a registry error** — check your network/proxy; retry the installer.

The compiled-binary path (`bun run build` → `scripts/build.ts`) still exists for source checkouts: the OpenTUI Solid transform is applied at build time via `@opentui/solid/bun-plugin`, and the executable does not autoload `bunfig.toml` (`autoloadBunfig: false`).

- **`error: preload not found "@opentui/solid/preload"` on launch** — the binary predates the hermetic build, or you are running `bun` against a `bunfig.toml` (project or `~/.bunfig.toml`) with a `preload` line that cannot resolve outside the clone. Reinstall with the current installer; if it persists, remove the `preload` entry from the global bunfig.
- **App starts but the TUI never appears** (log shows `Orphan text error` / `unhandledRejection` with no UI) — binaries built before the hermetic build compiled Solid TSX with the wrong JSX transform. Rebuild via the current installer; `scripts/build.ts` now applies the correct transform explicitly.

## See also

- [README](../README.md) — project background
- [configuration/providers.md](configuration/providers.md) — getting a model configured
- [usage.md](usage.md) — first session walkthrough
