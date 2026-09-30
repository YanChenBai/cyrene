<h1 align="center">Cyrene</h1>

<p align="center">A TypeScript dependency injection library with lazy initialization, type inference, and resource disposal.</p>

<p align="center"><a href="./README.md">简体中文</a> · English</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="./packages/cyrenex/README.en.md">Core package</a> ·
  <a href="./packages/elysia/README.en.md">Elysia integration</a> ·
  <a href="#development">Development</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyrenex"><img src="https://img.shields.io/npm/v/cyrenex?style=flat&labelColor=18212f&color=a78bfa" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/module-ESM-a78bfa?style=flat&labelColor=18212f" alt="ESM" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.6.0-5fa777?style=flat&labelColor=18212f" alt="Node.js 22.6.0 or later" />
</p>

<a id="quick-start"></a>

## Quick start

Requires Node.js 22.6.0 or later.

```sh
npm install cyrenex
```

```ts
import { Cyrene, ripple } from 'cyrenex';

const Message = ripple('message', () => 'Hello, Cyrene!');
const app = new Cyrene().use(Message);

console.log(app.ripples.message); // Hello, Cyrene!
await app.dispose();
```

`ripple()` declares a service, `use()` registers an entry, and reading `ripples` creates the instance on demand.
See the [core documentation](./packages/cyrenex/README.en.md) for dependencies, async initialization, and lifetimes.

## Features

- Reference service declarations as dependencies, with inferred input and return types.
- Resolve synchronous services directly and asynchronous services through promises.
- Use singletons, transient instances, lazy dependencies, and overrides before initialization.
- Inspect dependency graphs and release resources through `Symbol.dispose` / `Symbol.asyncDispose`.

## Packages and examples

| Directory                                         | Purpose                    |
| ------------------------------------------------- | -------------------------- |
| [cyrenex](./packages/cyrenex/README.en.md)        | Core runtime               |
| [@cyrenex/elysia](./packages/elysia/README.en.md) | Elysia route integration   |
| [example](./example/README.en.md)                 | Complete runnable examples |

The core package also includes an [Agent skill](./packages/cyrenex/skills/cyrenex/SKILL.md).

<a id="development"></a>

## Development

Run from the repository root:

```sh
vp install
vp run -r build
vp check
vp test run
```

See the [design document (Chinese)](./packages/cyrenex/docs/CYRENE_DESIGN.md) and [tests](./packages/cyrenex/tests) for implementation details and behavior.
