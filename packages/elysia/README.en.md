<h1 align="center">@cyrenex/elysia</h1>

<p align="center">Use Cyrene services in Elysia routes with type inference and resource disposal.</p>

<p align="center"><a href="./README.md">简体中文</a> · English</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#shared-routes">Shared routes</a> ·
  <a href="#lifecycle">Lifecycle</a> ·
  <a href="../cyrenex/README.en.md">Core package</a> ·
  <a href="#agent">Agent</a> ·
  <a href="#development">Development</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cyrenex/elysia"><img src="https://img.shields.io/npm/v/@cyrenex/elysia?style=flat&labelColor=18212f&color=a78bfa" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/module-ESM-a78bfa?style=flat&labelColor=18212f" alt="ESM" />
</p>

<a id="quick-start"></a>

## Quick start

```sh
npm install @cyrenex/elysia cyrenex elysia
```

```ts
import { elysiaCyrene, useRipples } from '@cyrenex/elysia';
import { ripple } from 'cyrenex';
import { Elysia } from 'elysia';

const Message = ripple('message', () => 'Hello, Cyrene!');
const app = new Elysia()
  .use(elysiaCyrene())
  .use(useRipples(Message))
  .get('/', ({ ripples }) => ripples.message);

const response = await app.handle(new Request('http://localhost/'));
console.log(await response.text()); // Hello, Cyrene!
await app.decorator.cyrene.dispose();
```

Install `cyrenex` and `elysia` as application peer dependencies. Elysia must satisfy `^1.4.0`.
This example handles a request through `app.handle()` without starting a server.

## Registration and resolution

`elysiaCyrene()` creates a container exposed through `context.cyrene` and `app.decorator.cyrene`.
`useRipples(...declarations)` registers entries and adds typed `context.ripples` to subsequent routes.
Install `elysiaCyrene()` before calling `useRipples()`.

- Registration does not run factories. The first property read resolves dependencies.
- Synchronous entries return instances; asynchronous entries return promises. Use `async` / `await` in async routes.
- Repeated `useRipples()` calls accumulate entry types. The same declaration can be registered again; different declarations cannot share a key.
- Indirect dependencies are collected automatically. Only explicitly registered entries appear on `ripples`.
- The first resolution locks the graph. Complete registration and `cyrene.override()` before handling requests.
- `ripples` is a read-only property view. Do not enumerate services through `Object.keys()`, object spread, or JSON serialization. Inspect the graph with `cyrene.inspect()`.

See the [core documentation](../cyrenex/README.en.md) for declarations and dependencies.

<a id="shared-routes"></a>

## Shared routes

Reuse one plugin instance to share a container. Following Elysia's explicit dependency pattern, each route module installs the plugin and declares its entries.
Using `Message` from the quick start:

```ts
const container = elysiaCyrene();

const first = new Elysia()
  .use(container)
  .use(useRipples(Message))
  .get('/first', ({ ripples }) => ripples.message);

const second = new Elysia()
  .use(container)
  .use(useRipples(Message))
  .get('/second', ({ ripples }) => ripples.message);

const app = new Elysia().use(container).use(first).use(second);
```

Separate calls to `elysiaCyrene()` create separate containers for separate applications. Reuse an instance within one application to avoid decorator name conflicts.

<a id="lifecycle"></a>

## Lifecycle

The default `singleton` lifetime shares instances within the container, including async initialization started by concurrent requests.
`transient` creates an instance for each property read, **not one instance per request**. Its disposable resources remain held until container shutdown.

The plugin's `onStop` hook calls `cyrene.dispose()` to release resources implementing `Symbol.dispose` or `Symbol.asyncDispose`.
Disposal order, borrowed resources, and pending initialization follow the core rules.

Whether an Elysia adapter waits for async stop hooks depends on the adapter. To await cleanup and catch disposal errors explicitly:

```ts
try {
  await app.stop();
} finally {
  await container.decorator.cyrene.dispose();
}
```

When using only `app.handle()` / `app.fetch()` without a listening server, call `await container.decorator.cyrene.dispose()` in your application's shutdown flow.
Disposal is idempotent; resolution is unavailable afterward. Stop in-flight business tasks before disposal.

<a id="agent"></a>

## Agent

The package includes a [cyrenex-elysia skill](./skills/cyrenex-elysia/SKILL.md) with examples for plugin registration, shared containers, request tests, and disposal.
If you use `skills-npm`, run `npx skills-npm` to sync installed package skills. See the [core Agent guide](../cyrenex/README.en.md#agent) for initial setup.

<a id="development"></a>

## Development

Run from the repository root. Build first to generate declarations needed by type checking:

```sh
vp install
vp run -r build
vp check
vp test run
```
