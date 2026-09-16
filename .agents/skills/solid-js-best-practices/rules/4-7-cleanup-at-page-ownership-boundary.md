---
id: 4-7
title: Cleanup at the Page Ownership Boundary
category: State Management
priority: HIGH
description: Use per-page cleanup when multiple routed panes remain mounted
---

## Problem

In split-pane layouts, multiple routed pages can remain mounted simultaneously. Resetting shared
context state whenever the pathname changes clears state owned by panes that did not unmount.

## Correct

Place cleanup with the page or resource owner and use `onCleanup` when that owner actually
unmounts. Treat navigation as a state change, not proof that every previous page disappeared.

Test narrow and wide layouts because their mounting lifecycles may differ.
