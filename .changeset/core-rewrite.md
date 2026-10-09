---
"cyrenex": patch
---

Rewrite the core runtime with scopes and runtime registration.

- Add the `scoped` lifetime and `Cyrene.scope()`. Singletons are shared, scoped instances are cached per scope, and transient resources belong to the scope that resolved them. Singletons cannot depend on scoped services.
- `use()` and `override()` work at any time. An override ends the target and every service that strongly depends on it, in the root and in all scopes, and recreates them on the next resolution.
- `ResolutionError.path` now holds the full chain from the entry to the failing service. Failed singletons are no longer cached and are retried on the next resolution.
- `lazy()` can target a Verse.
- Breaking: removed `verseAsync()`. `Verse` is now always synchronous and its type parameters are `Verse<T, Key>`.
- Breaking: removed the `Graph`, `DuplicateNodeError`, and `MissingNodeError` exports and the `'failed'` node state; `inspect()` nodes now include `lifetime`. Cycles and missing Verse providers are reported at resolution time.
