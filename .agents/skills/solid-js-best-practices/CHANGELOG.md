# Changelog

All notable changes to this skill will be documented in this file.

## [1.8.0] - 2026-05-14 - Generic web component integration guidance

### Added

- 2 new rules for web component integration:
  - 9-4: Thin Web Component Wrappers (HIGH) - wrappers own layout, labels, type adaptation, and form-library glue; custom elements own state timing, native fallback sync, and event payloads.
  - 9-5: Property vs Attribute Binding (HIGH) - use `prop:*` for controlled state and rich data such as options, plugins, callbacks, and object arrays.

### Changed

- Rule 5-7 now recommends declarative `prop:value`, `prop:open`, `prop:defaultValue`, `prop:defaultOpen`, `prop:options`, and `prop:plugin` when custom elements expose framework-safe APIs.
- Rule 9-2 now treats wrapper timers for slot timing as a custom element API smell rather than Solid wrapper responsibility.
- Rule 9-3 examples now use generic `<wc-*>` components and `on:wc-*` custom event names.
- `SKILL.md`, `README.md`, and `AGENTS.md` updated to 61 rules across 9 categories, with Web Component Integration expanded to 5 rules.
## [1.7.0] - Reactive and WC integration rules from post-mortem analysis

### Added

- 1 new rule for control flow
  - 3-7: Use keyed for Stateful Children (HIGH) — `<Show>`/`<Match>` use boolean equality by default; stateful children (forms, subscriptions) silently retain stale state when the input value changes but stays truthy; `keyed` forces remount on reference change
- 3 new rules for web component integration lifecycle (new category 9: Web Component Integration)
  - 9-1: Register Custom Elements at App Entry (HIGH) — import `/define` side-effects at app entry before `render()`; late registration upgrades existing elements synchronously mid-frame inside the browser upgrade algorithm
  - 9-2: Defer slotchange Handler Side Effects (HIGH) — `slotchange` fires inside SolidJS `runUpdates` on second+ navigation when shadow DOM already exists; defer all focus, state writes, and DOM mutations via `queueMicrotask`
  - 9-3: Treat Custom Element and SolidJS Reactivity as Decoupled (MEDIUM) — custom element internal state and SolidJS signals are independent systems; one-way data flow (SolidJS → attributes/properties → custom events → SolidJS); never read element properties from `createEffect`
- Debugging note in rule 1-4: SolidJS's infinite-loop guard watches `Updates` only, not `Effects`; silent tab freeze with zero console output indicates `Effects` accumulation; includes `Effects.push` diagnostic patch
- `batch()` no-op section in rule 1-6: `batch()` calls `runUpdates` which short-circuits if `Updates` already exists; calling it inside an effect or reactive context is always a no-op
- Reactive overhead section in rule 3-4: `<Switch>` creates 2N+4 memos vs `<Show>`'s 3; prefer `<Show>` for single-condition gates on heavy components
- "Web Component Integration" task-based rule selection in SKILL.md
- 6 new entries in Common Mistakes table

### Changed

- Rule count updated from 55 to 59
- Control Flow category expanded from 6 to 7 rules
- Added category 9: Web Component Integration (3 rules: 9-1, 9-2, 9-3)
- Skill trigger description broadened to activate on any SolidJS project context, not only "best practices" mentions

## [1.6.0] - Web component integration rules

### Added

- 3 new library-agnostic rules for integrating web component / custom element libraries
  - 2-10: Custom Element TypeScript Declarations (HIGH) - Extend `solid-js` JSX namespace; augment DOM types for `popover`/`popoverTarget`; `as unknown as JSX.CSSProperties` cast for experimental CSS; `prop:` prefix for JS properties
  - 5-7: Web Component Controlled State (HIGH) - `createEffect` + ref + imperative API pattern; `<dialog>` and Popover API as primary examples; `prop:` for object/array values; `onCleanup` for manual listeners
  - 6-6: Web Component CSS and Bundle Strategy (MEDIUM) - Per-component imports and side-effect registration file; `::part()` overrides must be in a non-module global stylesheet; CSS variables vs `::part()` trade-off; Workbox precache tuning
- "Custom Element Event Typing" section in rule 5-6: `CustomEvent<T>` typing, `ToggleEvent`, `on:close`; React 18 vs 19 comparison note
- "Experimental CSS Properties Not Yet in TypeScript's DOM Types" section in rule 2-8: `as unknown as JSX.CSSProperties` cast helper pattern
- "Integrating Web Components / Custom Elements" task-based rule selection in SKILL.md
- 8 new entries in Common Mistakes table

### Changed

- Rule count updated from 52 to 55
- Components category expanded from 9 to 10 rules
- Refs & DOM category expanded from 6 to 7 rules
- Performance category expanded from 5 to 6 rules
- React vs Solid comparison table updated with custom event handling row

## [1.5.0] - Integration testing rules

### Added

- 5 new rules for integration testing patterns from real browser-mode test experience
  - 8-7: Browser Mode for Web Components and PWA APIs (HIGH) - When jsdom fails (custom element lifecycle, shadow DOM, IDB, crypto); `userEvent` from `vitest/browser`
  - 8-8: Testing Headless UI Libraries with Non-Standard ARIA (MEDIUM) - Portal content, non-obvious roles (Kobalte example), when `.querySelector()` is acceptable
  - 8-9: Browser-Native API Test Isolation (HIGH) - Close IDB connection before `deleteDatabase`; `onblocked` no-op pattern; `useCleanDb()` helper
  - 8-10: Router Integration Testing (HIGH) - `MemoryRouter` `root` prop pattern; `makeLayout()` factory; `renderWithProviders`/`renderRoute` helpers
  - 8-11: TanStack Query Test Setup (HIGH) - `makeTestQueryClient()` with `retry: false`, `staleTime: 0`, `gcTime: 0`
- Vitest workspace config section in rule 8-1: `defineWorkspace` split for unit (jsdom) and integration (browser/Chromium) projects, `as any` plugin cast, `headless: true` for CI
- "Testing Empty and Absent States" section in rule 8-4: settled anchor pattern for asserting absence after async load
- "Form Accessible Name" section and table row in rule 7-2: `<form>` requires `aria-label`/`aria-labelledby` to be exposed as `role="form"`
- 6 new entries in Common Mistakes table

### Changed

- Rule count updated from 47 to 52
- Testing category expanded from 6 to 11 rules
- "Writing Tests" task-based rule selection updated with 8-7 through 8-11

## [1.4.0] - Reactive scope and mount stability rules

### Added

- 3 new rules derived from real-world reactive scope bugs
  - 2-9: Never Call Components as Functions (CRITICAL) - JSX/`createComponent()` only; direct calls leak reactive scope
  - 1-7: No Primitives in Reactive Contexts (HIGH) - Don't call hooks or create reactive primitives inside effects/memos
  - 3-6: Stable Component Mount (MEDIUM) - Avoid same component in multiple Switch/Show branches; use CSS for layout changes
- 3 new entries in Common Mistakes table

### Changed

- Rule count updated from 44 to 47
- Components category expanded from 8 to 9 rules
- Reactivity category expanded from 6 to 7 rules
- Control Flow category expanded from 5 to 6 rules
- Updated Code Review task-based selection with new CRITICAL (2-9) and HIGH (1-7) rules
- Updated Writing New Components task-based selection with 2-9

## [1.3.0] - ESLint plugin gap analysis

### Added

- 6 new rules based on [eslint-plugin-solid](https://github.com/solidjs-community/eslint-plugin-solid) gap analysis
  - 2-6: Components Return Once (CRITICAL) - Never use early returns; use `<Show>`, `<Switch>` in JSX
  - 2-7: No React-Specific Props (HIGH) - Use `class` not `className`, `for` not `htmlFor`
  - 2-8: Style Prop Conventions (MEDIUM) - Object syntax with kebab-case and string values
  - 5-5: Avoid innerHTML (HIGH) - Prevent XSS; use JSX or sanitize with DOMPurify
  - 5-6: Event Handler Patterns (MEDIUM) - Delegated vs native events, `on:`/`oncapture:`, array handlers
  - 6-5: Prefer classList (LOW) - Use `classList` prop for conditional class toggling
- Tooling section in SKILL.md recommending `eslint-plugin-solid`
- 5 new entries in Common Mistakes table
- `eslint-plugin-solid` link in README.md Resources section

### Changed

- Rule count updated from 38 to 44
- Components category expanded from 5 to 8 rules
- Refs & DOM category expanded from 4 to 6 rules
- Performance category expanded from 4 to 5 rules
- Expanded React vs Solid comparison table with `className`/`class`, `htmlFor`/`for`, style syntax, and early returns
- Updated Code Review task-based selection with new CRITICAL and HIGH rules
- Updated Writing New Components task-based selection with 2-6

## [1.2.0] - Testing category

### Added

- New category 8: Testing, with 6 rules (8-1 through 8-6)
  - 8-1: Configure Vitest for Solid (CRITICAL) - Vitest config with resolve conditions, plugin, deps
  - 8-2: Wrap Render in Arrow Functions (CRITICAL) - `render(() => <C />)` not `render(<C />)`
  - 8-3: Test Primitives in a Root (HIGH) - `createRoot`/`renderHook` for reactive ownership
  - 8-4: Handle Async in Tests (HIGH) - `findBy` queries, fake timer config, portal queries
  - 8-5: Use Accessible Queries (MEDIUM) - Role/label query priority over test IDs
  - 8-6: Separate Logic from UI Tests (MEDIUM) - `renderHook`/`renderDirective` for isolated testing
- "Writing Tests" task-based rule selection in SKILL.md
- 3 testing-related entries in Common Mistakes table

### Changed

- Rule count updated from 32 to 38, categories from 7 to 8
- Updated SKILL.md frontmatter description
- Updated README.md features, categories table, and TODO checklist
- Updated AGENTS.md file structure and category list

## [1.1.0] - Skill structure improvements

### Changed

- Fixed SKILL.md frontmatter to use only valid Claude Code fields (`name`, `description`, `allowed-tools`)
- Expanded description with discovery-relevant phrases for better skill activation
- Capitalized tool names to match Claude Code identifiers (`Read`, `Grep`, `Glob`)
- Merged task-based rule selection, common mistakes table, and React comparison from AGENTS.md into SKILL.md
- Trimmed AGENTS.md to contributor-focused content only
- Added YAML frontmatter (id, title, category, priority, description) to all 32 rule files
- Updated README.md to reflect new file structure

### Removed

- Removed invalid frontmatter fields (`trigger_phrases`, `requirements`, `keywords`, `license`, `author`, `version`)
- Removed inline `# Title` and `**Priority:** X` lines from rule files (now in frontmatter)
- Deleted `rules/index.json` (metadata now lives in each rule file's frontmatter)
- Deleted `metadata.json` (duplicated frontmatter)
- Deleted `examples.md` (trivial duplicates of rule file content)
- Deleted `reference.md` (stub with placeholder text)
- Deleted empty `scripts/` directory
- Deleted empty `.github/` directory

## [1.0.0] - Initial release

- Initial set of 32 rules and documentation
