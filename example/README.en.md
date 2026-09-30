<h1 align="center">Cyrene examples</h1>

<p align="center">Runnable dependency injection examples with no database or external services.</p>

<p align="center"><a href="./README.md">简体中文</a> · English</p>

## Quick start

Run from the repository root:

```sh
vp install
vp run --filter @cyrenex/example start
```

The command builds the core package before running the examples. The examples use `await using` and require a compatible runtime.
For a minimal example, see the [core quick start](../packages/cyrenex/README.en.md#quick-start).

## Examples

| File                                     | Covers                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| [basic.ts](./src/basic.ts)               | Synchronous dependencies, singleton reuse, overrides, graph inspection, and disposal |
| [async.ts](./src/async.ts)               | Async initialization, lazy dependencies, and concurrent resolution                   |
| [registration.ts](./src/registration.ts) | Separate registration calls, declaration resolution, and borrowed resources          |

[src/index.ts](./src/index.ts) runs all three scenarios. Assertions check instance identity, creation counts, and disposal ownership.
See the [core documentation](../packages/cyrenex/README.en.md) for the API and behavior.
