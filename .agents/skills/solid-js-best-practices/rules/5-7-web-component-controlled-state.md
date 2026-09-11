---
title: Web Component Controlled State
priority: HIGH
category: Refs & DOM
---

# Web Component Controlled State

## Rule

When a custom element exposes framework-safe properties, bind Solid state declaratively with `prop:*` and listen for composed custom events with `on:*`. Use imperative refs and effects only for native browser APIs or legacy custom elements that do not expose declarative property contracts.

## Incorrect

```tsx
let select!: HTMLWcSelectElement;

createEffect(() => {
  select.setSelectedValues(selectedIds());
});

<wc-select
  ref={select}
  on:wc-select-change={(event) => setSelectedIds(event.detail.selectedValues)}
/>
```

```tsx
<wc-select
  value={selectedIds()}
  options={categoryOptions()}
/>
```

## Correct

```tsx
<wc-select
  prop:value={selectedIds()}
  prop:options={categoryOptions()}
  on:wc-select-change={(event: CustomEvent<WcSelectChangeDetail>) => {
    setSelectedIds(event.detail.selectedValues);
  }}
/>
```

```tsx
<wc-dialog
  prop:open={isOpen()}
  prop:defaultOpen={false}
  on:wc-dialog-toggle={(event: CustomEvent<WcDialogToggleDetail>) => {
    setIsOpen(event.detail.open);
  }}
/>
```

```tsx
<wc-textarea
  prop:value={body()}
  prop:plugin={markdownPlugin}
  on:wc-textarea-change={(event: CustomEvent<{ value: string }>) => {
    setBody(event.detail.value);
  }}
/>
```

## Native API Exception

Native platform APIs may still require imperative refs because their public API is method-based, not property-based.

```tsx
let dialog!: HTMLDialogElement;

createEffect(() => {
  if (open() && !dialog.open) dialog.showModal();
  if (!open() && dialog.open) dialog.close();
});

<dialog ref={dialog} onClose={() => setOpen(false)} />
```

## Why It Matters

Solid runs components once and updates DOM bindings through fine-grained effects. `prop:*` writes JavaScript properties, which is the right channel for custom element state, object arrays, plugins, and callbacks. Declarative property/event flow avoids wrapper-level timers, manual mount ordering, duplicated default-selection state, and reactivity loops.

## Related Rules

- [5-6 Event Handler Patterns](5-6-event-handler-patterns.md)
- [9-3 Decouple Lit and Solid Reactivity](9-3-decouple-lit-and-solid-reactivity.md)
- [9-4 Thin Web Component Wrappers](9-4-thin-web-component-wrappers.md)
- [9-5 Property vs Attribute Binding](9-5-property-vs-attribute-binding.md)
