---
id: 7-4
title: End-Match Root Router Links
category: Accessibility
priority: HIGH
description: Add end matching so the root link is not current on every route
---

## Problem

A router link to `/` prefix-matches every route and can expose `aria-current="page"` throughout
the application.

## Correct

Use the router's exact/end-match option for the root navigation link:

```tsx
<A href="/" end>Home</A>
```

Verify `aria-current` on the root page and on at least one nested route.
