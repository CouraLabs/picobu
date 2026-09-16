---
title: Property vs Attribute Binding
priority: HIGH
category: Web Component Integration
---

# Property vs Attribute Binding

## Rule

Use `prop:*` for custom element public APIs that are property-based, especially controlled state and all rich data. Use attributes for static strings, booleans that the element explicitly reflects, and HTML-only progressive enhancement.

## Incorrect

```tsx
<wc-select
  value={selectedIds()}
  options={options()}
  plugin={markdownPlugin}
/>
```

This writes attributes, so arrays and objects become strings such as `"[object Object]"`.

## Correct

```tsx
<wc-select
  prop:value={selectedIds()}
  prop:defaultValue={initialIds}
  prop:options={options()}
  disabled={isDisabled()}
  on:wc-select-change={(event: CustomEvent<WcSelectChangeDetail>) => {
    setSelectedIds(event.detail.selectedValues);
  }}
/>
```

```tsx
<wc-dialog
  prop:open={open()}
  prop:defaultOpen={false}
  on:wc-dialog-toggle={(event: CustomEvent<{ open: boolean }>) => setOpen(event.detail.open)}
/>
```

```tsx
<wc-textarea prop:plugin={markdownPlugin} />
```

## Why It Matters

Solid treats normal JSX attributes as HTML attributes unless a binding uses the `prop:` namespace. Custom elements commonly expose JavaScript properties for `value`, `open`, `options`, callbacks, and plugin objects. Binding those through attributes loses identity, breaks updates, and can hide bugs until real browser integration.

## Related Rules

- [5-6 Event Handler Patterns](5-6-event-handler-patterns.md)
- [5-7 Web Component Controlled State](5-7-web-component-controlled-state.md)
- [9-4 Thin Web Component Wrappers](9-4-thin-web-component-wrappers.md)
