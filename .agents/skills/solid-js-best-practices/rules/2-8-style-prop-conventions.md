---
id: 2-8
title: Style Prop Conventions
category: Components
priority: MEDIUM
description: Use object syntax with kebab-case properties and string values for the style prop
---

## Problem

Solid.js requires the `style` prop to be an object (not a string) with **kebab-case** CSS property names and **string values** for dimensions. Using a string, React's camelCase property names, or bare numbers will produce broken or silently ignored styles.

## Incorrect

```tsx
// ❌ WRONG: String style (not supported)
<div style="color: red; font-size: 16px;" />
```

```tsx
// ❌ WRONG: React camelCase property names
<div style={{ fontSize: "16px", backgroundColor: "red", marginTop: "10px" }} />
```

```tsx
// ❌ WRONG: Bare number values (React convention)
<div style={{ "font-size": 16, padding: 8 }} />
```

## Correct

```tsx
// ✅ CORRECT: Object with kebab-case and string values
<div style={{ color: "red", "font-size": "16px" }} />
```

```tsx
// ✅ CORRECT: Full example with multiple properties
function Card(props) {
  return (
    <div
      style={{
        "background-color": props.bg ?? "white",
        "border-radius": "8px",
        padding: "16px",
        "box-shadow": "0 2px 4px rgba(0,0,0,0.1)",
        "max-width": "400px",
      }}
    >
      {props.children}
    </div>
  );
}
```

### Reactive Styles

```tsx
import { createSignal } from "solid-js";

// ✅ CORRECT: Reactive values in style object
function ProgressBar(props) {
  return (
    <div
      style={{
        width: `${props.percent}%`,
        height: "8px",
        "background-color": props.percent > 80 ? "green" : "blue",
        transition: "width 0.3s ease",
      }}
    />
  );
}
```

### Conditional Styles

```tsx
// ✅ CORRECT: Conditionally include style properties
function Alert(props) {
  return (
    <div
      style={{
        padding: "12px",
        "border-left": `4px solid ${props.type === "error" ? "red" : "blue"}`,
        "background-color": props.type === "error" ? "#fee" : "#eef",
        display: props.visible ? "block" : "none",
      }}
    >
      {props.message}
    </div>
  );
}
```

## React to Solid Style Comparison

| React | Solid | Notes |
| ----- | ----- | ----- |
| `fontSize: 16` | `"font-size": "16px"` | Kebab-case, explicit units |
| `backgroundColor: "red"` | `"background-color": "red"` | Kebab-case |
| `marginTop: "10px"` | `"margin-top": "10px"` | Kebab-case |
| `style="color: red"` | `style={{ color: "red" }}` | Must be an object |
| `zIndex: 10` | `"z-index": "10"` | String values for numbers |

## CSS Custom Properties

```tsx
// ✅ CORRECT: CSS variables work in the style object
<div
  style={{
    "--theme-color": props.color,
    "--spacing": "8px",
    color: "var(--theme-color)",
    padding: "var(--spacing)",
  }}
/>
```

## Why It Matters

1. **Silent Failures**: String styles and camelCase properties are silently ignored — no error, just missing styles.

2. **Solid Compiles Styles**: Solid compiles style objects to efficient `setProperty` calls. String styles bypass this optimization.

3. **Migration Pitfall**: React developers instinctively write camelCase style properties. This is a mechanical but frequent migration fix.

4. **Type Safety**: When using TypeScript with kebab-case properties, incorrect property names are caught at compile time.

## Experimental CSS Properties Not Yet in TypeScript's DOM Types

Some newer CSS features — CSS Anchor Positioning (`anchor-name`, `position-anchor`), `view-timeline-name`, and others — may not yet appear in TypeScript's `JSX.CSSProperties` type. Attempting to use them produces a type error.

### Safe Cast Pattern

Use `as unknown as JSX.CSSProperties` rather than `as never`. The `as never` cast removes all type checking on the object; the `unknown` cast is narrower and preserves checking on all other properties:

```tsx
// ❌ WRONG: as never disables type checking on the entire object
<div style={{ "anchor-name": "--btn", color: "red" } as never} />

// ✅ CORRECT: only the experimental property needs the cast
<div
  style={
    { "anchor-name": "--btn", color: "red" } as unknown as JSX.CSSProperties
  }
/>
```

### Typed Helper for Repeated Use

```tsx
// ✅ CORRECT: a helper that accepts experimental props without losing safety elsewhere
const experimentalCss = (props: Record<string, string>): JSX.CSSProperties =>
  props as unknown as JSX.CSSProperties;

// Usage
<div
  style={{
    ...experimentalCss({ "anchor-name": "--my-anchor" }),
    color: "red",  // still type-checked
    "font-size": "16px",
  }}
/>
```

The same pattern applies to any CSS property ahead of TypeScript's DOM lib: `container-type`, `view-timeline-name`, `position-anchor`, `overlay`, etc.

## Related Rules

- [2-7: No React-Specific Props](2-7-no-react-specific-props.md) - Other React prop name differences
- [6-5: Prefer classList](6-5-prefer-classlist.md) - Conditional class toggling
- [2-10: Custom Element TypeScript Declarations](2-10-custom-element-typescript-declarations.md) - Augmenting TS types for custom elements and newer HTML attributes
