<h1 align="center">Cyrene</h1>

<p align="center">A TypeScript dependency injection library with lazy initialization, type inference, and resource disposal.</p>

<p align="center"><a href="./README.md">简体中文</a> · English</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#features">Features</a> ·
  <a href="#agent">Agent</a> ·
  <a href="./docs/CYRENE_DESIGN.md">Design (Chinese)</a> ·
  <a href="#development">Development</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyrenex"><img src="https://img.shields.io/npm/v/cyrenex?style=flat&labelColor=18212f&color=a78bfa" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/module-ESM-a78bfa?style=flat&labelColor=18212f" alt="ESM" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.6.0-5fa777?style=flat&labelColor=18212f" alt="Node.js 22.6.0 or later" />
</p>

<a id="quick-start"></a>

## Quick start

Requires Node.js 22.6.0 or later. The package provides ESM exports and TypeScript declarations.

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

`ripple()` declares a service, `use()` registers an entry, and the first read of `ripples` creates its instance.
Synchronous services return instances directly; asynchronous services return promises.

<a id="features"></a>

## Features

- **Explicit dependencies** — Declare dependencies and factories with `ripple()`. Plain inputs pass through unchanged.
- **Type inference** — Factory inputs and instances are inferred. Chained `use()` calls accumulate public entry types.
- **Async initialization** — Independent branches initialize in parallel. Concurrent singleton resolutions share initialization.
- **Overrides before resolution** — Replace implementations before the first resolution, which validates and locks the graph.
- **Lazy dependencies** — Inject a resolution handle with `lazy()`, respecting the target lifetime.
- **Resource disposal** — Dispose in reverse completion order through Symbol disposal protocols or `await using`.

## Eager initialization

Keep resolving on demand, or explicitly warm up the container before accepting requests or running tasks:

```ts
const app = new Cyrene().use(Service);
try {
  await app.init();
  // All reachable singletons are ready for application work.
} finally {
  await app.dispose();
}
```

`init(): Promise<void>` initializes every singleton in the effective graph, including internal dependencies and lazy targets, reusing pending or completed initialization.
It does not independently pre-create transients. Strong dependencies of singletons still create transients normally, using the effective lifetime after overrides.

The call immediately locks configuration and validates the complete graph before starting independent branches concurrently. Repeated calls return the same Promise, including failures.
Failures are reported after all batch branches settle, without automatic rollback or retry. Dispose the container even after failure to release resources.
`dispose()` waits for an accepted initialization batch. Calls to `init()` after shutdown begins return a rejected Promise.
Do not await the same container's `init()` inside a factory: it would wait for itself to finish.

## Declarations and instances

```text
ripple(key, factory)       → describe how to create a service
new Cyrene().use(Service)  → register a public entry and collect dependencies
app.ripples.service       → resolve an instance, initializing on first access
await app.dispose()       → wait for initialization and release resources
```

- Use `ripple(key, factory)` or `ripple(key, deps, factory)`. Keys are immutable, non-empty strings.
- Reference Ripple objects as dependencies. Input property names may differ from their target keys.
- Plain inputs, including nested objects and ordinary promises, pass through unchanged.

| Lifetime              | Creation and reuse                                                     |
| --------------------- | ---------------------------------------------------------------------- |
| `singleton` (default) | One instance per container; concurrent initialization shares a promise |
| `transient`           | The factory runs on every resolution                                   |

## Registration and dependencies

`use()` registers public entries and automatically collects their dependencies:

```ts
const Config = ripple('config', () => ({ prefix: 'app' }));
const Logger = ripple('logger', { config: Config }, ({ config }) => ({
  format: (message: string) => `[${config.prefix}] ${message}`,
}));
const Users = ripple('users', { logger: Logger }, ({ logger }) => ({
  describe: () => logger.format('users'),
}));

const app = new Cyrene().use(Users);

app.ripples.users.describe(); // Public entry
app.resolve(Config).prefix; // Internal dependency, resolved by declaration
// app.ripples.config is not available
```

Expose more entries with `new Cyrene().use(Users).use(Logger, Config)`.

> [!TIP]
> Chain `use()` calls or use their return values to accumulate public key types.
> After separate registration calls, `resolve(Ripple)` still infers the instance type.

<details>
<summary>Declaration identity and registration rules</summary>

- `use()` mutates and returns the same container. A batch is registered only after all entries pass validation.
- Registering the same declaration again is idempotent. Different declarations cannot share a key in the effective graph.
- Explicitly registering an internal dependency makes it a public entry.
- `resolve(Ripple)` uses declaration identity. `resolve(key)` can access internal nodes, but keys not accumulated in the container type return `unknown`.
- `isRipple()` identifies declarations created by the library.

Use ordinary functions to create declarations with different keys:

```ts
const logger = <const K extends string>(key: K, scope: string) => ripple(key, () => ({ scope }));

const app = new Cyrene().use(logger('auditLogger', 'audit'), logger('requestLogger', 'request'));
```

</details>

## Overrides before resolution

Use the original declaration to target either a public entry or an internal dependency:

```ts
const MockConfig = ripple('mockConfig', () => ({ prefix: 'test' }));
const app = new Cyrene().use(Users).override(Config, MockConfig);

app.ripples.users.describe(); // [test] users
app.resolve(Config) === app.resolve(MockConfig); // Same singleton
```

- The original key, visibility, return type, and sync/async contract remain unchanged.
- The replacement supplies the factory, dependencies, and lifetime.
- The first property read, `resolve()` call, or `init()` call locks configuration, even if initialization fails.

<details>
<summary>Override order and reachability</summary>

- `override()` may precede `use()`. The last override for a target wins.
- `override(original, original)` restores the original implementation.
- The graph collects only effective dependencies. Dependencies used only by the replaced implementation are removed.
- Override targets must remain reachable in the effective graph, including after upstream overrides.
- A replacement can represent only one node and cannot also occupy another entry or dependency node.
- Both the original and current replacement resolve to the node. Previous replacements no longer do.

</details>

## Synchronous and asynchronous services

Factories run after their strong dependencies are ready:

```ts
const Config = ripple('config', () => ({ name: 'demo' }));
const Database = ripple('database', async () => ({ query: () => ['Alice'] }));
const Users = ripple('users', { database: Database }, ({ database }) => ({
  list: () => database.query(),
}));

await using app = new Cyrene().use(Config, Users);

app.ripples.config.name; // Synchronous instance
const users = await app.ripples.users; // Wait for the async dependency
users.list();
```

| Situation                                           | Result                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| Factory and all strong dependencies are synchronous | Instance returned directly                                         |
| Factory or any strong dependency is asynchronous    | Promise; the factory receives resolved dependencies                |
| Only a lazy target is asynchronous                  | Consumer stays synchronous; resolving the handle returns a promise |
| Factory returns `T \| Promise<T>`                   | The union type is preserved                                        |

Entry properties are read-only. Service instances are not proxied. An async singleton keeps returning the same promise after initialization.

## Lazy resolution

During on-demand resolution, `lazy()` injects a handle that creates its target when the handle's `resolve()` is called. `init()` also eagerly initializes singleton targets:

```ts
import { lazy, ripple } from 'cyrenex';

const Report = ripple('report', { users: lazy(() => Users) }, ({ users }) => ({
  run: async () => (await users.resolve()).list(),
}));
```

- The callback should return a stable declaration without side effects.
- Callbacks run during graph construction; their results are reused while configuration stays unchanged.
- Express factory dependencies through inputs or lazy handles. Avoid awaiting public resolution or disposal on the same container inside a factory.

<details>
<summary>Promises and wait cycles during initialization</summary>

| Operation                                         | Registers a wait relationship  |
| ------------------------------------------------- | ------------------------------ |
| Calling async `lazy.resolve()` alone              | No; starts initialization only |
| Awaiting it or returning it from an async factory | Yes                            |
| Calling `then`, `catch`, or `finally`             | Yes, including observer chains |

During initialization, a handle reuses its promise wrapper for the target instance. This wrapper differs from the public entry promise.
Once the consumer is ready, the handle returns the target's resolution result directly.

Strong dependency cycles are rejected during graph construction. Actual async wait cycles are rejected during initialization.

</details>

## Transient instances

Use `transient` for objects such as per-task collectors or builders:

```ts
const Job = ripple('job', () => ({ messages: [] as string[] }), { lifetime: 'transient' });
const Worker = ripple('worker', { job: Job }, ({ job }) => ({ job }));

await using app = new Cyrene().use(Worker);

app.resolve(Job) !== app.resolve(Job); // New instance on each resolution
app.ripples.worker.job === app.ripples.worker.job; // Singleton retains its injected instance
```

| Operation                                             | Transient creation                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| Declaration, registration, override, graph inspection | Does not run factories                                                |
| Property read or `resolve()`                          | Creates an instance each time                                         |
| Strong dependency injection                           | Creates an instance per input property during consumer initialization |
| `lazy.resolve()`                                      | Creates an instance per call; injecting the handle creates none       |
| Concurrent async resolution                           | Independent initialization and different promises                     |

> [!NOTE]
> Transient reruns the factory; it does not clone an object the factory intentionally reuses.
> Owned instances with disposal protocols remain held until container disposal. Limit their creation in long-running containers.

See the [resolution design (Chinese)](./docs/CYRENE_DESIGN.md#解析) for retry, recursion, and state tracking details.

## Diagnostics and failures

`inspect()` validates the graph and returns a snapshot without running factories or locking configuration:

```ts
import { formatGraph } from 'cyrenex';

console.log(formatGraph(app.inspect()));
```

| Field   | Meaning                                                             |
| ------- | ------------------------------------------------------------------- |
| `roots` | Explicitly registered public entries                                |
| `nodes` | Keys and latest initialization states in the effective graph        |
| `edges` | Consumer, input property, target, and strong/lazy dependency policy |

Tree output uses `↗` for shared nodes and `↻` for cycles. ANSI sequences and terminal control characters are removed.

| Failure                                                      | Behavior                       |
| ------------------------------------------------------------ | ------------------------------ |
| Invalid graph, invalid entry, or synchronous factory failure | Throws immediately             |
| Async factory failure                                        | Rejects the promise            |
| Singleton initialization failure                             | Caches the failure             |
| Transient initialization failure                             | Retries on the next resolution |

The caller must still dispose the container after a failure to release registered resources.

## Resource disposal

Use `await using` with a compatible runtime or TypeScript toolchain, or call `await app.dispose()` explicitly.
Resources implement `Symbol.asyncDispose` or `Symbol.dispose`; the async protocol takes precedence:

```ts
const Database = ripple('database', async () => {
  const connection = await openConnection();

  return {
    query: connection.query.bind(connection),

    async [Symbol.asyncDispose]() {
      await connection.close();
    },
  };
});
```

`openConnection` is supplied by your database driver.

| Instance                        | Ownership and disposal                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| Owned with a disposal protocol  | Held until shutdown; disposed in reverse order of first completed creation                |
| Plain object                    | Ownership is tracked through weak references; collectible when no other references remain |
| `ownership: 'borrowed'`         | Managed by the application; not disposed by the container                                 |
| Same object returned repeatedly | Disposed once; mixing owned and borrowed ownership throws                                 |

> [!TIP]
> Stop accepting work and wait for in-flight tasks before disposing the container.
> The container waits for accepted initialization. Business methods, streams, and background tasks remain the application's responsibility.

<details>
<summary>Disposal order and responsibilities</summary>

- `dispose()` is idempotent. It closes resolution immediately, waits for accepted initialization, then releases resources.
- Strong dependencies usually complete first and are disposed after consumers. Lazy targets activated later and object aliases follow actual first-completion order.
- Disposal continues after individual failures and reports aggregated errors at the end.
- Singleton caches retain their results; weak ownership tracking does not change that.
- Ordinary `.dispose()` methods and option-based cleanup callbacks are not part of the protocol.
- Transient does not provide request scopes or automatic cleanup after each call.
- Factories must clean up resources allocated but not returned before throwing.

</details>

<a id="agent"></a>

## Agent

The package includes a [cyrenex skill](./skills/cyrenex/SKILL.md) for registration, overrides, lazy resolution, and disposal.
After installing `cyrenex`, use [skills-npm](https://github.com/antfu/skills-npm) to link it to your agent's skill directory:

```sh
npm install -D skills-npm
npx skills-npm setup
```

Setup detects agents, performs the initial sync, adds syncing to `package.json`'s `prepare` script, and ignores generated links.
Future dependency installs and updates keep the skill in sync. To sync manually:

```sh
npx skills-npm
```

<a id="development"></a>

## Development

Implementation lives in [src](./src), tests in [tests](./tests), and ESM plus declarations are built into `dist/`.
Run from this package directory:

```sh
vp install
vp run ready
```

| Command        | Purpose                       |
| -------------- | ----------------------------- |
| `vp check`     | Format, lint, and type checks |
| `vp test run`  | Tests                         |
| `vp pack`      | Build ESM and declarations    |
| `vp run ready` | Run checks, tests, and build  |

See the [design document (Chinese)](./docs/CYRENE_DESIGN.md) and [tests](./tests/) for behavioral details.
