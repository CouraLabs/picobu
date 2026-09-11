---
id: 9-6
title: Register Custom Fields with Form Libraries
category: Web Component Integration
priority: HIGH
description: Ensure property-bound custom fields enter lazy form-library registries
---

## Problem

Some form libraries create field state lazily only after their getter, setter, or registration
primitive is used. Passing only `prop:defaultValue` to a custom element can bypass that path, so
the field is absent from submitted values.

## Correct

Adapt the custom element through the form library's supported registration API before submit.
Test the untouched-default case as well as user-edited values; a form that only works after the
first interaction is not correctly registered.
