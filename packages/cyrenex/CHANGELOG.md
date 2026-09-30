# cyrenex

## 0.0.1-beta.0

### Patch Changes

- First beta release of Cyrene and its Elysia integration. ([#1](https://github.com/YanChenBai/cyrene/pull/1)), by [@YanChenBai](https://github.com/YanChenBai).
  
  ### Core runtime
  
  - Declare typed services with `ripple()` and register public entries with `Cyrene.use()`; dependencies are collected automatically.
  - Initialize services on demand with synchronous and asynchronous resolution, singleton and transient lifetimes, and lazy dependencies.
  - Replace implementations before the first resolution, inspect dependency graphs, and release owned resources through Symbol disposal protocols.
  
  ### Elysia integration
  
  - Create an application container with `elysiaCyrene()` and expose typed route services with `useRipples()`.
  - Share services across route modules and concurrent requests, with container disposal during application shutdown.
  
  Both packages include Chinese and English documentation and agent skills with runnable examples.
