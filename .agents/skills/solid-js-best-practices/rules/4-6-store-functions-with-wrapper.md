---
id: 4-6
title: Store Functions with a Wrapper
category: State Management
priority: HIGH
description: Wrap function values so setStore does not invoke them as updater functions
---

## Problem

`setStore("key", fn)` treats `fn` as an updater and calls it. The function is not stored as the
new value.

## Correct

Wrap the function in an updater that returns it:

```typescript
setStore("callback", () => callback);
```

Use a signal or a plain non-reactive object when function identity is the primary state rather
than one field in a larger store.
