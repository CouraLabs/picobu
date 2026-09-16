---
id: 9-1
title: Register Custom Elements at App Entry
category: Web Component Integration
priority: HIGH
description: Import custom element define side-effects at the app entry point, before any SolidJS reactive context is established
---

## Problem

Custom element registration changes how the browser treats a tag fundamentally. An unregistered
custom element is a plain `HTMLElement` — no shadow DOM, no lifecycle callbacks, no slot
management. Once registered, the browser upgrades existing and future instances, firing
`connectedCallback`, `adoptedCallback`, and slot assignment synchronously during the upgrade
algorithm.

If custom elements are registered **after** SolidJS components have mounted, the browser
upgrades all existing DOM instances at that moment, firing their lifecycle hooks mid-frame inside
whatever JavaScript is currently executing — which may be a SolidJS reactive update pass.

## Incorrect

```typescript
// site.tsx — ❌ WRONG: lazy import triggers registration after route renders
import { lazy } from "solid-js";
import { Router, Route } from "@solidjs/router";

const RecipesPage = lazy(() => import("./routes/RecipesPage"));

// Custom elements only registered when RecipesPage loads.
// Existing <wc-toolbar> instances in the shell upgrade mid-navigation.
export function App() {
  return (
    <Router>
      <Route path="/recipes/*" component={RecipesPage} />
    </Router>
  );
}
```

```typescript
// ❌ WRONG: registration inside a component
import { onMount } from "solid-js";

function Shell() {
  onMount(() => {
    // Fires after first render — upgrades existing elements inside runUpdates cleanup
    import("@acme/wc-components/define");
  });

  return <wc-toolbar />;
}
```

## Correct

```typescript
// site.tsx — ✅ CORRECT: side-effect import at the top of the entry module,
// before createRoot or any SolidJS rendering begins.
import "@acme/wc-components/define";

import { render } from "solid-js/web";
import { App } from "./App";

render(() => <App />, document.getElementById("root")!);
```

```typescript
// ✅ CORRECT: individual package define imports also work, as long as they're
// at the module's top level and not inside async boundaries or lazy chunks.
import "@acme/wc-toolbar/define";
import "@acme/wc-splitter/define";
import "@acme/wc-combobox/define";

import { render } from "solid-js/web";
import { App } from "./App";

render(() => <App />, document.getElementById("root")!);
```

### Why the `/define` Subpath

Many web component packages export two entry points:

```typescript
// Main export: just the class, no side effects
import { WcToolbar } from "@acme/wc-toolbar";  // Does NOT call customElements.define()

// Define subpath: registers the element
import "@acme/wc-toolbar/define";              // Calls customElements.define("wc-toolbar", WcToolbar)
```

If your bundler or aggregator imports from the main entry rather than `/define`, no elements
are registered and the browser treats all custom tags as plain `HTMLElement`. Always verify
which subpath you are importing.

## Why It Matters

1. **Upgrade timing**: Elements upgrade synchronously when `customElements.define()` is called
   for a tag already present in the DOM. Calling `define()` after SolidJS mounts means upgrades
   fire inside the browser's upgrade algorithm, which runs at an indeterminate point during frame
   processing — not at a safe SolidJS boundary.

2. **Lifecycle predictability**: `connectedCallback`, `disconnectedCallback`, and `slotchange`
   are all stable once an element is registered before first render. Late registration means the
   first `connectedCallback` fires at upgrade time, not at insertion time — breaking assumptions
   about when shadow DOM and slot assignments exist.

3. **Event delegation**: SolidJS delegates common events (click, keydown, etc.) at the document
   root. Late-upgraded elements that add capture-phase listeners after delegation is set up can
   interfere with SolidJS's event processing order.

## Related Rules

- [9-2: Defer slotchange Handler Side Effects](9-2-defer-slotchange-handlers.md) - Safe slot handling
- [9-3: Treat Custom Element and SolidJS Reactivity as Decoupled](9-3-decouple-lit-and-solid-reactivity.md) - Reactivity boundary design
- [5-6: Event Handler Patterns](5-6-event-handler-patterns.md) - Use `on:` for custom element events
