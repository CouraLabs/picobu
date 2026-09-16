---
id: 8-12
title: Deproxy Before Structured Clone
category: Testing
priority: HIGH
description: Remove every reactive proxy before writing data to IndexedDB
---

## Problem

IndexedDB structured cloning rejects Solid and TanStack Query reactive proxies. Shallow-spreading
the outer object is insufficient when any nested array or object remains proxied.

## Correct

Convert the complete persisted payload to plain data before writing it. Copy every nested array
and object intentionally, or use a serialization boundary whose supported data types match the
schema. Add an integration test that writes and reads the real payload in browser mode.
