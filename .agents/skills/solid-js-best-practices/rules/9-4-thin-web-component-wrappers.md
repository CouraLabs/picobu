---
title: Thin Web Component Wrappers
priority: HIGH
category: Web Component Integration
---

# Thin Web Component Wrappers

## Rule

Solid wrappers around custom elements should adapt app concerns, not repair custom element behavior. Let the custom element own value/default handling, option synchronization, native fallback synchronization, slot timing, focus internals, and event emission.

## Incorrect

```tsx
const CategorySelect: Component<Props> = (props) => {
  let select!: HTMLWcSelectElement;

  onMount(() => {
    setTimeout(() => select.setSelectedValues(props.value));
  });

  createEffect(() => {
    for (const option of select.querySelectorAll('option')) {
      option.selected = props.value.includes(option.value);
    }
  });

  return <wc-select ref={select}>{props.children}</wc-select>;
};
```

## Correct

```tsx
const CategorySelect: Component<Props> = (props) => {
  const options = createMemo(() =>
    props.categories.map((category) => ({
      value: category.id,
      label: category.name,
    })),
  );

  return (
    <label class="field">
      <span>{props.label}</span>
      <wc-select
        prop:value={props.value}
        prop:options={options()}
        on:wc-select-change={props.onChange}
      />
    </label>
  );
};
```

## Wrapper Responsibilities

- Labels, descriptions, validation messages, and layout.
- Type adaptation between domain objects and custom element string values.
- Form-library registration and error display.
- CSS class composition and app-specific theming hooks.

## Custom Element Responsibilities

- Controlled and uncontrolled state contracts.
- Default selection and initial native fallback reads.
- Option mutation, slot timing, and native control synchronization.
- Rich custom event detail objects.

## Why It Matters

Wrappers that compensate for custom element timing become hard to reason about in Solid because render, slot assignment, and custom element updates are separate systems. Thin wrappers keep app code boring and push reusable integration guarantees into the web component library.

## Related Rules

- [5-7 Web Component Controlled State](5-7-web-component-controlled-state.md)
- [9-2 Defer Slotchange Handler Side Effects](9-2-defer-slotchange-handlers.md)
- [9-5 Property vs Attribute Binding](9-5-property-vs-attribute-binding.md)
