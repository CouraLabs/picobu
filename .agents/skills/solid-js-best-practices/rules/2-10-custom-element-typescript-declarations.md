---
id: 2-10
title: Custom Element TypeScript Declarations
category: Components
priority: HIGH
description: Declare custom element tags in the solid-js JSX namespace and augment TypeScript's DOM types for newer HTML attributes and experimental CSS properties
---

## Problem

TypeScript has no knowledge of custom elements by default. Using any `<my-element>` tag in JSX produces LSP errors, and props have no type safety. Similarly, newer HTML attributes (`popover`, `popoverTarget`) and experimental CSS properties (`anchor-name`, `position-anchor`) may not yet exist in the TypeScript DOM lib, causing unnecessary `@ts-ignore` usage that hides real errors.

## Incorrect

```tsx
// ❌ WRONG: TypeScript error — JSX element 'my-dropdown' has no corresponding type
<my-dropdown open={isOpen()} />

// ❌ WRONG: @ts-ignore suppresses real errors in the same file
// @ts-ignore
<button popoverTarget="my-panel">Open</button>

// ❌ WRONG: `as never` disables type checking on the entire style object
<div style={{ "anchor-name": "--anchor-btn" } as never} />
```

## Correct

### 1. Declare Custom Elements in the Solid JSX Namespace

Create a `src/custom-elements.d.ts` file (any name works as long as it is included by `tsconfig.json`):

```typescript
// src/custom-elements.d.ts
import type { JSX } from "solid-js";

// Import element class types from your library when available
// import type { MyDropdown } from "my-component-library";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      // Basic custom element with typed props
      "my-dropdown": {
        open?: boolean;
        placement?: "top" | "bottom" | "left" | "right";
        "on:my-open"?: (e: CustomEvent<void>) => void;
        "on:my-close"?: (e: CustomEvent<void>) => void;
        ref?: (el: HTMLElement) => void;
        children?: JSX.Element;
      };

      // Use library-provided element types when available
      // "my-dropdown": MyDropdown["Props"] & { ref?: (el: MyDropdown) => void };

      // Catch-all for any other custom elements (less type-safe but unblocks LSP)
      [tagName: `${string}-${string}`]: Record<string, unknown> & {
        ref?: (el: HTMLElement) => void;
        children?: JSX.Element;
      };
    }
  }
}
```

### 2. Augment Newer HTML Attributes Missing from the DOM Lib

Some recent HTML attributes (`popover`, `popoverTarget`, `popoverTargetAction`) may not yet be in the TypeScript DOM lib. Declare them in the same `.d.ts` file:

```typescript
// src/custom-elements.d.ts (continued)

// Augment built-in HTML element types for newer spec attributes
declare global {
  interface HTMLElement {
    // Native Popover API — popover host attribute
    popover?: "auto" | "manual" | "";
  }

  interface HTMLButtonElement {
    // Native Popover API — trigger button attributes
    popoverTarget?: string;
    popoverTargetAction?: "toggle" | "show" | "hide";
  }

  interface HTMLInputElement {
    popoverTarget?: string;
    popoverTargetAction?: "toggle" | "show" | "hide";
  }
}
```

And in the Solid JSX namespace, so they work in JSX:

```typescript
declare module "solid-js" {
  namespace JSX {
    interface HTMLAttributes<T> {
      popover?: "auto" | "manual" | "";
    }

    interface ButtonHTMLAttributes<T> {
      popoverTarget?: string;
      popoverTargetAction?: "toggle" | "show" | "hide";
    }
  }
}
```

### 3. Type Custom Events Correctly

Solid's `on:` prefix binds directly to the native DOM event. Type the handler with `CustomEvent<T>` using the detail type:

```tsx
// ✅ CORRECT: typed custom event handler
<my-select
  on:my-change={(e: CustomEvent<{ value: string }>) => {
    setSelected(e.detail.value);
  }}
/>

// ✅ CORRECT: typed toggle event (Popover API)
<div
  popover="auto"
  on:toggle={(e: ToggleEvent) => {
    setOpen(e.newState === "open");
  }}
/>
```

### 4. Experimental CSS Properties

Use `as unknown as JSX.CSSProperties` instead of `as never` — it preserves type checking on the rest of the object:

```tsx
// ❌ WRONG: as never disables all type checking on the style object
<div style={{ "anchor-name": "--btn", color: "red" } as never} />

// ✅ CORRECT: as unknown as JSX.CSSProperties — only the unknown props need the cast
const anchorStyle = (name: string): JSX.CSSProperties =>
  ({ "anchor-name": name } as unknown as JSX.CSSProperties);

<div
  style={{
    ...anchorStyle("--my-anchor"),
    color: "red",   // still type-checked
  }}
/>

// ✅ CORRECT: inline cast for a one-off
<div
  style={
    { "anchor-name": "--my-anchor", color: "red" } as unknown as JSX.CSSProperties
  }
/>
```

### 5. The `prop:` Prefix for JS Properties (Not HTML Attributes)

Custom elements often expose JavaScript properties that are not HTML attributes. HTML attributes are always strings; properties can be objects, arrays, or booleans. Use `prop:` so Solid sets the DOM property instead of calling `setAttribute`:

```tsx
// ❌ WRONG: sets the attribute — complex values become "[object Object]"
<my-select options={optionsList()} />

// ✅ CORRECT: sets the JS property directly
<my-select prop:options={optionsList()} />

// ✅ CORRECT: also works for boolean properties
<my-toggle prop:checked={isChecked()} />
```

## Why It Matters

1. **LSP noise**: Undeclared custom elements produce errors on every usage, making it hard to spot real mistakes.
2. **Type safety**: Typed props and events catch mismatches at compile time — e.g., passing a string where a `boolean` is expected.
3. **`@ts-ignore` debt**: Suppressing errors hides real bugs in adjacent lines; targeted declarations or casts are always preferable.
4. **`prop:` correctness**: Passing arrays or objects without `prop:` silently coerces them to strings — no error, wrong behavior.

## Related Rules

- [5-6: Event Handler Patterns](5-6-event-handler-patterns.md) — `on:` syntax and custom event typing
- [5-7: Web Component Controlled State](5-7-web-component-controlled-state.md) — imperative APIs and `prop:` for value sync
- [2-8: Style Prop Conventions](2-8-style-prop-conventions.md) — CSS custom properties and style object format
