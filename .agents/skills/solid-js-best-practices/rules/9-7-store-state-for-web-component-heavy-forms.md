---
id: 9-7
title: Store State for Web-Component-Heavy Forms
category: Web Component Integration
priority: MEDIUM
description: Prefer a Solid store when custom elements already own field interaction
---

## Rule

When most fields are custom elements that expose controlled properties and change events, a
typed `createStore` can be simpler than adapting every field through a form library.

Keep validation and submission requirements explicit. Use a form library when its schema,
validation, touched-state, or nested-field capabilities remove more complexity than the custom
element adapters add.
