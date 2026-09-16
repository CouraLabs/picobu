---
id: 9-3
title: Treat Custom Element and SolidJS Reactivity as Decoupled
category: Web Component Integration
priority: MEDIUM
description: Custom element internal state and SolidJS signals are independent reactive systems — design for one-way data flow and event-driven communication
---

## Problem

Custom elements manage their own internal state through whatever mechanism their implementation
uses (Lit `@state`, Stencil `@State`, FAST observables, or hand-rolled `attributeChangedCallback`
logic). These systems are all asynchronous and component-scoped. SolidJS signals are synchronous
and fine-grained. The two systems do not communicate — a change in one does not propagate to the
other automatically.

When developers assume the two systems are integrated, they introduce patterns that create
invisible coupling: `slotchange` handlers that write SolidJS signals, form libraries whose
effects depend on web component-managed DOM, or MutationObservers that indirectly trigger signal
updates. These patterns fail at non-obvious times (see rule 9-2) and produce hard-to-reproduce
bugs.

## One-Way Data Flow

Treat the boundary between SolidJS and a custom element as a strict one-way interface:

```
SolidJS signals / stores
      ↓  (attributes, properties, slotted children)
  custom element
      ↓  (custom events, callbacks)
SolidJS signal setters / event handlers
```

SolidJS owns the data. Custom elements display it and report user interactions upward. The
custom element never writes to a SolidJS signal directly.

## Bridge at the Boundary

Use declarative `prop:*` bindings for modern custom element property APIs. Use
`createEffect` as an explicit bridge only when the element exposes an imperative API or a
legacy property contract that cannot be expressed declaratively.

```tsx
// Legacy property bridge: SolidJS signal -> custom element property.
let slider!: HTMLElement & { value: number; valueText: string };

createEffect(() => {
  slider.value = position();
  slider.valueText = label();
});

<wc-slider
  ref={slider}
  on:wc-slider-change={(event: CustomEvent<{ value: number }>) => {
    setPosition(event.detail.value);
  }}
/>;
```

Native platform APIs can also require imperative effects because their public API is
method-based:

```tsx
let dialog!: HTMLDialogElement;

createEffect(() => {
  if (isOpen() && !dialog.open) dialog.showModal();
  if (!isOpen() && dialog.open) dialog.close();
});
```

Type refs as DOM-facing public contracts, not implementation classes. Avoid forcing consumers
to import the custom element's framework type just to write a wrapper:

```typescript
let slider!: HTMLElement & { value: number; valueText: string };
```

## Incorrect

```typescript
// ❌ WRONG: MutationObserver inside a custom element writes a SolidJS signal
// Applies regardless of element framework (Lit, Stencil, FAST, vanilla).
class RCSelect extends HTMLElement {
  private _onMutation = () => {
    // Calling a SolidJS setter from inside an async MO callback:
    // - fires at indeterminate time relative to SolidJS's reactive cycle
    // - bypasses SolidJS's batch/transition tracking
    solidSignalSetter(this._deriveValue());
  };
}
```

```tsx
// ❌ WRONG: reading custom element internal state from a SolidJS createEffect.
// Element properties backed by internal state are not SolidJS signals — the
// effect will NOT re-run when the element re-renders.
createEffect(() => {
  const el = comboboxRef as RCCombobox;
  console.log(el.open); // reads an element property — not reactive in SolidJS
});
```

## Correct

### Pass Data Down via Attributes and Properties

```tsx
import { createSignal } from "solid-js";

// ✅ CORRECT: SolidJS drives the custom element via reactive attribute bindings.
// When selectedValue() changes, SolidJS updates the DOM attribute directly.
function CategorySelector(props) {
  return (
    <wc-combobox
      value={props.selectedValue}
      disabled={props.disabled}
      placeholder="Select category..."
      on:wc-select-change={(e: CustomEvent) => props.onSelect(e.detail.value)}
    />
  );
}
```

### Listen to Events via on: Namespace

```tsx
import { createSignal } from "solid-js";

// ✅ CORRECT: custom element events require on: (not delegated onClick).
// SolidJS cannot delegate events it doesn't know about at compile time.
function SearchBar() {
  const [query, setQuery] = createSignal("");

  return (
    <wc-search-input
      value={query()}
      on:wc-input={(e: CustomEvent<string>) => setQuery(e.detail)}
      on:wc-clear={() => setQuery("")}
    />
  );
}
```

### Mirror Element State in SolidJS Signals via Events

```tsx
// ✅ CORRECT: use SolidJS state as the source of truth, not the element's
// internal state. Mirror what you need in SolidJS signals via events.
function Combobox(props) {
  const [isOpen, setIsOpen] = createSignal(false);

  return (
    <wc-combobox
      on:wc-open={() => setIsOpen(true)}
      on:wc-close={() => setIsOpen(false)}
    >
      <Show when={isOpen()}>
        <span class="combobox-indicator">▲</span>
      </Show>
    </wc-combobox>
  );
}
```

## Reactive System Comparison

| Concern | SolidJS | Custom Element |
| ------- | ------- | -------------- |
| Scheduling | Synchronous | Async (microtask, rAF, or framework-dependent) |
| Granularity | Signal-level (property) | Component-level (whole element) |
| Reactivity source | `createSignal`, `createStore` | Internal state (`@state`, `@State`, observables, etc.) |
| Cleanup | `onCleanup` | `disconnectedCallback` |
| Cross-boundary | Attributes, properties, events | Custom events, callbacks |

## The Async Gap

A custom element's async internal update cycle creates a timing gap:

1. SolidJS effect writes a property on a custom element.
1. The element schedules an internal re-render — async.
1. SolidJS effect completes.
1. Element re-renders (next microtask checkpoint or animation frame).
1. Element re-render may change slot contents.
1. `slotchange` fires — potentially inside SolidJS's next reactive update pass.

This chain can create apparent cycles that are actually just the two systems taking turns. The
fix is always to make the element's output (custom events) the authoritative signal source and
avoid reading internal element state from SolidJS reactive contexts.

## MutationObserver on SolidJS-Managed DOM

Custom elements sometimes observe their slotted children via `MutationObserver` (e.g., watching
a `<select>` for `<option>` changes managed by SolidJS `<For>`). This is safe as long as:

1. The MO callback writes only to the element's own internal state, not to SolidJS signals.
1. The MO callback is set up in a deferred handler (see rule 9-2), not synchronously during
   `slotchange`.
1. The `MutationObserver` is disconnected in `disconnectedCallback` to prevent leaks.

```typescript
// ✅ CORRECT: MO inside a custom element watching SolidJS-managed DOM
override disconnectedCallback(): void {
  super.disconnectedCallback();
  this._mutationObserver?.disconnect();
}
```

## Related Rules

- [9-1: Register Custom Elements at App Entry](9-1-register-custom-elements-early.md) - Registration timing
- [9-2: Defer slotchange Handler Side Effects](9-2-defer-slotchange-handlers.md) - slotchange safety
- [9-5: Property vs Attribute Binding](9-5-property-vs-attribute-binding.md) - Use `prop:*` for property APIs
- [5-7: Web Component Controlled State](5-7-web-component-controlled-state.md) - Prefer property/event flow
- [5-6: Event Handler Patterns](5-6-event-handler-patterns.md) - Use `on:` namespace for custom element events
- [5-3: Cleanup with onCleanup](5-3-cleanup-with-oncleanup.md) - Cleaning up observers on SolidJS side
