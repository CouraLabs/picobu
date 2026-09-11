---
id: 9-2
title: Defer slotchange Handler Side Effects
category: Web Component Integration
priority: HIGH
description: Always defer synchronous DOM mutations, focus changes, and state writes in slotchange handlers via queueMicrotask or requestAnimationFrame
---

## Problem

`slotchange` fires synchronously when the browser assigns or removes a slotted element. On the
**first** mount of a custom element that defers shadow root creation (e.g. via an async update
queue), the shadow DOM doesn't yet exist when SolidJS inserts the slotted child. There is no
shadow `<slot>` to assign it to, so `slotchange` does **not** fire synchronously.

On every **subsequent** mount (the user navigates away and back), the shadow DOM persists across
`disconnectedCallback`/`connectedCallback`. When SolidJS re-inserts the slotted child during its
reactive update pass (`runUpdates`), the shadow `<slot>` already exists and the browser
immediately assigns the element — firing `slotchange` **synchronously inside `runUpdates`**.

Any synchronous work in the handler — calling `.focus()`, writing internal component state,
traversing the DOM, dispatching events — runs inside SolidJS's active reactive cycle. This can
corrupt the update pass, trigger unintended reactive subscriptions, or cascade into further
mutations.

Bugs that appear only on the **second or later** navigation to a route are a common symptom of
this pattern.

## Incorrect

```typescript
// wc-toolbar.ts — ❌ WRONG: synchronous focus call in slotchange
protected _initItems(): void {
  const items = this._getItems();

  // On second+ navigation, this fires inside SolidJS runUpdates.
  // Calling focus() synchronously here moves DOM focus mid-reactive-cycle.
  if (items.length > 0) {
    items[0].focus();
  }
}

protected _onSlotChange(_e: Event): void {
  this._initItems();
}
```

```typescript
// wc-select.ts — ❌ WRONG: synchronous internal state writes and MutationObserver setup
protected _handleSelectSlotChange(e: Event): void {
  const sel = this._getSlottedSelect(e);

  // On second+ navigation, these property writes run inside SolidJS runUpdates.
  // The element's async update queue schedules a re-render, but the property
  // setter itself fires synchronously right here.
  this.multiple = sel.multiple;
  this.disabled = sel.disabled;
  this._syncOptionsFromSelect(sel); // triggers internal state update synchronously

  // MutationObserver setup is cheap, but calling it here clutters the reactive frame.
  this._mutationObserver = new MutationObserver(/* ... */);
  this._mutationObserver.observe(sel, { childList: true });
}
```

## Correct

```typescript
// wc-toolbar.ts — ✅ CORRECT: focus deferred via queueMicrotask
protected _initItems(): void {
  const items = this._getItems();

  // queueMicrotask defers focus until after the current synchronous task completes,
  // safely outside SolidJS's runUpdates pass.
  queueMicrotask(() => {
    if (items.length > 0) {
      items[0].focus();
    }
  });
}

protected _onSlotChange(_e: Event): void {
  this._initItems();
}
```

```typescript
// wc-select.ts — ✅ CORRECT: all side effects deferred together
protected _handleSelectSlotChange(e: Event): void {
  const sel = this._getSlottedSelect(e);
  if (!sel) return;

  // Cache the reference synchronously (cheap, no side effects).
  this._selectRef = new WeakRef(sel);

  // Defer everything that mutates state or the DOM.
  queueMicrotask(() => {
    const s = this._selectRef?.deref();
    if (!s) return;

    this.multiple = s.multiple;
    this.disabled = s.disabled;
    this._syncOptionsFromSelect(s);

    this._mutationObserver?.disconnect();
    this._mutationObserver = new MutationObserver(() => {
      const current = this._selectRef?.deref();
      if (current) this._syncOptionsFromSelect(current);
    });
    this._mutationObserver.observe(s, { childList: true, subtree: true, attributes: true });
  });
}
```

### Choosing the Right Deferral Mechanism

```typescript
// queueMicrotask: runs after current synchronous task, before paint.
// Use for: state sync, reference caching, non-visual initialization.
queueMicrotask(() => this._syncState());

// requestAnimationFrame: runs before next paint.
// Use for: layout reads, visual updates, ResizeObserver-driven work.
requestAnimationFrame(() => this._updateLayout());

// setTimeout(fn, 0): runs after microtasks and paint.
// Use for: rare cases where you need to yield to the full event loop.
// Generally prefer queueMicrotask over setTimeout(fn, 0).
```

## The First-vs-Second Mount Asymmetry

| Mount | Shadow DOM state | slotchange timing |
| ----- | ---------------- | ----------------- |
| First visit to route | Shadow DOM not yet rendered (element defers shadow root creation) | Deferred — fires after the element's first async render |
| Second+ visit to route | Shadow DOM persists from previous visit | **Synchronous** — fires inside SolidJS `runUpdates` |

This asymmetry makes the bug hard to catch in initial development. It only manifests after the
user has visited a route, navigated away, and returned. Integration tests that only test initial
render will miss it.

## Design Rule

Treat all `slotchange` handlers as if they **always** run inside `runUpdates`. Design them to
be instantaneous:

1. **Cache references** synchronously (a `WeakRef` assignment is safe).
1. **Schedule all work** via `queueMicrotask` or `requestAnimationFrame`.
1. **Never** call `focus()`, write reactive state, dispatch events, or mutate the light DOM
   synchronously from a `slotchange` handler.

## Related Rules

- [9-1: Register Custom Elements at App Entry](9-1-register-custom-elements-early.md) - Registration timing
- [9-3: Treat Custom Element and SolidJS Reactivity as Decoupled](9-3-decouple-lit-and-solid-reactivity.md) - Reactivity boundary design
- [5-3: Cleanup with onCleanup](5-3-cleanup-with-oncleanup.md) - Disconnecting observers on cleanup


## Wrapper Smell: Timers Fixing Slot Timing

A Solid wrapper should not need `setTimeout`, `queueMicrotask`, or `onMount` glue just to make a custom element notice its slotted children. The custom element should read assigned nodes synchronously, defer its own DOM writes or focus work, and handle late child insertion/replacement itself. Wrapper-level timers are a sign that the custom element API or lifecycle handling needs improvement.
