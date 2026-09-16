---
id: 6-6
title: Web Component CSS and Bundle Strategy
category: Performance
priority: MEDIUM
description: Import web components individually for tree-shaking; place ::part() overrides and CSS variable mappings in a global stylesheet, not CSS Modules
---

## Problem

Web component libraries bundle Shadow DOM templates and default styles per component. Two distinct issues arise when integrating them:

1. **Bundle size**: Importing an entire library in one statement pulls in all components, their templates, and their styles — even unused ones. This is especially problematic for PWAs with service worker precache limits.

2. **CSS encapsulation**: Shadow DOM encapsulates styles by design. `::part()` selectors — the standard way to reach shadow internals — do **not** work inside CSS Modules files, because CSS Modules transforms class names but cannot generate valid `::part()` selectors. Any `::part()` rule inside a `.module.css` file is silently ignored.

## Incorrect

```typescript
// ❌ WRONG: imports the entire library — all components, templates, and styles
import "my-component-library";
```

```css
/* ❌ WRONG: ::part() inside a CSS Module — the selector is never applied */
/* src/components/Dropdown.module.css */
.wrapper custom-select::part(listbox) {
  border-radius: 8px;
}
```

```css
/* ❌ WRONG: CSS custom property mapping inside a CSS Module
   The rule is scoped to a generated class name, so it never matches the element */
/* src/components/Dropdown.module.css */
.wrapper {
  --my-lib-border-radius: 8px;
}
```

## Correct

### Part A — Bundle Size: Individual Component Imports

Import only the components your app uses, from their specific module paths:

```typescript
// src/web-components.ts — register all custom elements in one side-effect file
// Import each component individually so the bundler can tree-shake unused ones

import "my-component-library/dist/components/button/button.js";
import "my-component-library/dist/components/select/select.js";
import "my-component-library/dist/components/dialog/dialog.js";
```

Import this file once at the app root, not in every component file that uses it:

```typescript
// src/main.tsx
import "./web-components.ts"; // registers all custom elements once
import { render } from "solid-js/web";
import App from "./App";

render(() => <App />, document.getElementById("root")!);
```

For heavy components only used on specific routes, prefer dynamic imports:

```typescript
// Lazy-load a heavy component only when the route is visited
const loadEditor = () => import("my-component-library/dist/components/rich-editor/rich-editor.js");

// In the component
onMount(async () => {
  await loadEditor();
  // editor is now registered and usable
});
```

### Part B — CSS Architecture: Global File for Shadow DOM Overrides

CSS Modules cannot generate `::part()` selectors. All shadow DOM overrides must live in a non-module global stylesheet:

```
src/
  styles/
    main.css           ← global stylesheet, imported once in main.tsx
    web-components.css ← all ::part() overrides and CSS variable mappings
  components/
    Dropdown.module.css ← component layout (margins, positioning, etc.)
```

```css
/* src/styles/main.css */
@import "./web-components.css";

/* app-wide styles */
```

```css
/* src/styles/web-components.css — non-module global file */

/* ::part() overrides — styling shadow internals */
custom-select::part(listbox) {
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

custom-select::part(option--selected) {
  background-color: var(--color-primary);
  color: white;
}

/* CSS custom property mappings — cross shadow boundary safely */
custom-select {
  --my-lib-focus-ring-color: var(--color-focus);
  --my-lib-border-radius: 8px;
}
```

```css
/* src/components/Dropdown.module.css — component layout only */
.wrapper {
  display: flex;
  gap: 8px;
  align-items: center;
}

.label {
  font-weight: 500;
}
```

### CSS Custom Properties vs `::part()`

CSS custom properties (`--my-var`) cross shadow boundaries — they are the safer, more composable theming mechanism when the library exposes them:

```css
/* ✅ PREFER: CSS variables cross the shadow boundary */
custom-button {
  --my-lib-color-primary: #0070f3;
  --my-lib-border-radius: 4px;
}

/* ✅ USE when the library doesn't expose a variable for the property you need */
custom-button::part(base) {
  letter-spacing: 0.05em;
}
```

### PWA / Service Worker Precache

If your app uses a service worker with Workbox and precaches build assets, large web component bundles can exceed the default `maximumFileSizeToCacheInBytes` limit (2 MB). Per-component imports mitigate this, but you may still need to tune the limit for components you can't split further:

```javascript
// vite.config.ts (or workbox config)
VitePWA({
  workbox: {
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
  },
});
```

Document the trade-off: a higher limit means a larger initial precache, but full offline support for all components.

## Why It Matters

1. **Bundle size**: A library barrel import often includes hundreds of kilobytes of unused component code. Individual imports let Rollup/Vite eliminate what isn't used.

2. **Silent CSS failures**: `::part()` inside a `.module.css` is not a build error — it compiles silently and simply never applies. This is one of the harder-to-diagnose styling issues in component integration.

3. **CSS variables are composable**: Unlike `::part()`, CSS variables defined at the host level cascade into all shadow roots in the subtree. They are the preferred theming mechanism when the library supports them.

4. **Separation of concerns**: Keeping shadow DOM overrides in a dedicated global file makes it easy to audit all third-party style customizations in one place.

## Related Rules

- [2-10: Custom Element TypeScript Declarations](2-10-custom-element-typescript-declarations.md) — typing custom element props
- [5-7: Web Component Controlled State](5-7-web-component-controlled-state.md) — imperative state sync
- [6-2: Use Lazy Components](6-2-use-lazy-components.md) — code splitting with `lazy()`
