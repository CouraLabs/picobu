---
id: 3-7
title: Use keyed for Stateful Children
category: Control Flow
priority: HIGH
description: Add keyed prop when the child component has internal state and the input value (not just truthiness) determines identity
---

## Problem

`<Show>` and `<Match>` use boolean equality by default: the child is only remounted when the condition transitions between truthy and falsy. When the input value changes but stays truthy — for example, navigating from record A to record B — the child component is **not remounted**. Stateful children (forms, scroll position, focus state) silently retain their previous state.

This failure mode produces no error. The component renders, appears correct, and shows wrong data.

## Incorrect

```tsx
import { Show } from "solid-js";

// ❌ WRONG: navigating from recipeA to recipeB does not remount RecipeForm.
// Felte/form state is retained from the previous record silently.
function RecipeDetail(props) {
  return (
    <Show when={props.recipe}>
      {(recipe) => <RecipeForm recipe={recipe()} />}
    </Show>
  );
}
```

```tsx
import { Switch, Match } from "solid-js";

// ❌ WRONG: switching between two different users does not remount UserForm
// if both values are truthy and the branch is the same <Match>.
function UserPanel(props) {
  return (
    <Switch>
      <Match when={props.selectedUser}>
        {(user) => <UserForm user={user()} />}
      </Match>
    </Switch>
  );
}
```

## Correct

```tsx
import { Show } from "solid-js";

// ✅ CORRECT: keyed compares by reference. recipeA !== recipeB → full remount.
// Form state is always fresh for the current record.
function RecipeDetail(props) {
  return (
    <Show when={props.recipe} keyed>
      {(recipe) => <RecipeForm recipe={recipe} />}
    </Show>
  );
}
```

```tsx
import { Switch, Match } from "solid-js";

// ✅ CORRECT: keyed on Match remounts UserForm whenever the user object changes.
function UserPanel(props) {
  return (
    <Switch>
      <Match when={props.selectedUser} keyed>
        {(user) => <UserForm user={user} />}
      </Match>
    </Switch>
  );
}
```

### Identifying Routes by ID When the Object Reference Is Unstable

```tsx
import { Show, createMemo } from "solid-js";

// If your query re-fetches and produces a new object reference on every load,
// key on the stable ID rather than the object itself.
function RecipeDetail(props) {
  // Derive a stable key — the object reference changes on refetch,
  // but the id only changes when the user navigates to a different recipe.
  const recipeId = createMemo(() => props.recipe?.id);

  return (
    <Show when={recipeId()} keyed>
      {() => <RecipeForm recipe={props.recipe} />}
    </Show>
  );
}
```

### When Not to Use keyed

```tsx
import { Show } from "solid-js";

// ✅ OK without keyed: UserAvatar has no internal state.
// Boolean condition is all that matters — show or hide.
function UserAvatar(props) {
  return (
    <Show when={props.user}>
      {(user) => <img src={user().avatarUrl} alt={user().name} />}
    </Show>
  );
}
```

## Why It Matters

### Default Equality Is Boolean

Internally, `<Show>` without `keyed` creates its condition memo with a boolean equality comparator:

```typescript
// SolidJS internals — condition memo for <Show> without keyed
condition = createMemo(conditionValue, undefined, { equals: (a, b) => !a === !b });
```

`!recipeA === !recipeB` is `true` when both are truthy, so the memo never changes, the child
is never torn down, and the form library (Felte, Modular Forms, etc.) keeps the state from the
previous render.

With `keyed`, full reference equality is used, so `recipeA !== recipeB` triggers a remount.

### The Failure Is Silent

Unlike a missing signal call or a destructured prop, a missing `keyed` causes no runtime error
and no console warning. The component renders with stale data that visually looks correct. It is
only noticed when the user tries to save and gets unexpected results.

### Applies to Both Show and Match

The same boolean-equality behavior applies to `<Match when={...}>`. Switching between two
different objects that match the same arm does not remount the child without `keyed`.

## Rule of Thumb

Any child component that:

- Initializes a form library (`createForm`, `useForm`, etc.)
- Holds local signal state that mirrors the input
- Manages its own scroll position or focus state
- Creates subscriptions tied to the input value

…needs `keyed` on the `<Show>` or `<Match>` that gates it.

Stateless display components (avatars, labels, read-only views) are fine without it.

## Show vs Match keyed Props

| Component | Without keyed | With keyed |
| --------- | ------------- | ---------- |
| `<Show>` | Remounts on falsy ↔ truthy transition only | Remounts on any reference change |
| `<Match>` | Remounts when a different arm matches | Remounts when value reference changes within same arm |

## Related Rules

- [3-1: Use Show for Conditionals](3-1-use-show-for-conditionals.md) - Base Show usage
- [3-4: Use Switch/Match](3-4-use-switch-match.md) - Multiple condition patterns
- [3-6: Stable Component Mount](3-6-stable-component-mount.md) - Controlling component identity
