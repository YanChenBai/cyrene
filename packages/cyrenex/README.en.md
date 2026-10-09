<h1 align="center">Cyrene</h1>

<p align="center">A TypeScript dependency injection library with lazy initialization, scopes, runtime overrides, and resource disposal.</p>

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

`ripple()` declares a service, `use()` registers an entry, and reading `ripples` creates the instance on first access.
Synchronous services return the instance directly; asynchronous services return a Promise.

<a id="features"></a>

## Features

- **Explicit dependencies**: `ripple()` describes dependencies and a factory; plain input values pass through unchanged
- **Type inference**: factory inputs and instance types are inferred, and chained `use()` calls accumulate entry key types
- **Async initialization**: dependencies initialize in parallel, and concurrent resolutions share one singleton initialization
- **Three lifetimes**: `singleton`, `scoped`, and `transient`, with `app.scope()` creating scopes
- **Register and replace at any time**: `use()` works after resolution; `override()` ends the target and every instance that depends on it
- **Lazy resolution**: `lazy()` injects a resolve handle and can reference declarations defined later
- **Unified disposal**: resources are released in reverse completion order, with Symbol disposal protocols and `await using`

## Declarations and registration

```text
ripple(key, factory)       → describe how to create a service
new Cyrene().use(Service)  → register an entry and collect its dependencies
app.ripples.service        → get the instance, initialized on first access
await app.dispose()        → wait for initialization, then release resources
```

`use()` only decides which services are public entries. Internal dependencies are collected automatically:

```ts
const Config = ripple('config', () => ({ prefix: 'app' }));
const Logger = ripple('logger', { config: Config }, ({ config }) => ({
  format: (message: string) => `[${config.prefix}] ${message}`,
}));
const Users = ripple('users', { logger: Logger }, ({ logger }) => ({
  describe: () => logger.format('users'),
}));

const app = new Cyrene().use(Users);

app.ripples.users.describe(); // public entry
app.resolve(Config).prefix; // internal dependency, resolved by declaration
// app.ripples.config does not exist
```

- Dependencies reference Ripple objects, and input names can differ from target keys. Plain inputs, including nested objects and Promises, are passed to the factory unchanged.
- Registering the same declaration again is idempotent. Different declarations with the same key throw.
- `use()` can be called after resolution, and existing scopes see the new entries.
- `resolve(Ripple)` looks up by declaration identity. `resolve(key)` looks up by key and can reach internal dependencies; keys without accumulated types resolve to `unknown`.

> [!TIP]
> Chain `use()` or keep its return value to accumulate entry key types.
> Entries added later can still be resolved with exact types through `resolve(Ripple)`.

To reuse declaration logic, create Ripples with different keys from a plain function:

```ts
const logger = <const K extends string>(key: K, scope: string) => ripple(key, () => ({ scope }));

const app = new Cyrene().use(logger('auditLogger', 'audit'), logger('requestLogger', 'request'));
```

## Synchronous and asynchronous services

```ts
const Config = ripple('config', () => ({ name: 'demo' }));
const Database = ripple('database', async () => ({ query: () => ['Alice'] }));
const Users = ripple('users', { database: Database }, ({ database }) => ({
  list: () => database.query(),
}));

await using app = new Cyrene().use(Config, Users);

app.ripples.config.name; // synchronous, returns the instance
const users = await app.ripples.users; // async dependency, returns a Promise
users.list();
```

| Case                                         | Result                                                     |
| -------------------------------------------- | ---------------------------------------------------------- |
| Factory and all strong dependencies are sync | Returns the instance                                       |
| Factory or any strong dependency is async    | Returns a Promise; the factory receives ready dependencies |
| Only a lazy target is async                  | The consumer stays sync; the handle returns a Promise      |
| Factory returns `T \| Promise<T>`            | The union type is preserved                                |

An async singleton returns the same Promise during and after initialization.

## Lifetimes and scopes

| Lifetime              | Cached in                                    | Resources owned by         |
| --------------------- | -------------------------------------------- | -------------------------- |
| `singleton` (default) | The root container, shared by all scopes     | The root container         |
| `scoped`              | Each scope; the root container counts as one | The scope                  |
| `transient`           | Not cached; created on every resolution      | The scope that resolved it |

```ts
const Db = ripple('db', () => openDb());
const Session = ripple('session', { db: Db }, ({ db }) => db.session(), { lifetime: 'scoped' });

const app = new Cyrene().use(Session);

{
  await using request = app.scope();
  request.ripples.session === request.ripples.session; // reused within the scope
} // closing the scope releases its session

await app.dispose(); // closes live scopes first, then releases root resources
```

- A scope from `app.scope()` shares the registry and singletons with the root container, and exposes only `ripples`, `resolve()`, and `dispose()`.
- A singleton cannot depend on a scoped service directly, through a transient, or through a lazy handle; doing so throws `InvalidDependencyError`.
- Disposable transient instances belong to the scope that resolved them and are released when it closes. Creating a scope per request keeps these resources from piling up until container shutdown.

## Dependency contracts by key

`verse<T>(key)` declares a synchronous contract whose implementation is found by key. Consumers only need the contract, not the provider's Ripple:

```ts
import { Cyrene, ripple, verse } from 'cyrenex';

interface AgentOptions {
  prefix: string;
}

const AgentConfig = verse<AgentOptions>('agentConfig');
const Agent = ripple('agent', { config: AgentConfig }, ({ config }) => ({
  label: (name: string) => `${config.prefix}: ${name}`,
}));

const app = new Cyrene().use(
  ripple(AgentConfig, () => ({ prefix: 'app' })),
  Agent,
);

app.ripples.agent.label('Alice'); // 'app: Alice'
await app.dispose();
```

- Contracts find implementations by key, so they do not need to be the same verse object. Providers can use `ripple('agentConfig', factory)` or `ripple(AgentConfig, factory)`; the latter also checks the return type.
- Implementations must enter the registry through `use()` or as another Ripple's dependency. Because registration is dynamic, a missing implementation is reported at resolution time.
- Implementations must return synchronously; a Promise result throws `InvalidDependencyError`. For services that need async initialization, depend on their Ripple directly, or have the implementation synchronously return an object that handles the async work internally.
- After specifying `T` explicitly, the key type defaults to `string`. To accumulate an exact entry name, write `verse<AgentOptions, 'agentConfig'>('agentConfig')`.

## Overrides

`override(original, replacement)` targets the original declaration and can be called at any time:

```ts
const MockConfig = ripple('mockConfig', () => ({ prefix: 'test' }));
const app = new Cyrene().use(Users);

app.ripples.users.describe(); // [app] users
app.override(Config, MockConfig);
app.ripples.users.describe(); // [test] users, Users was recreated
```

- **Kept**: the original key and visibility. The types require the replacement to match the original's result and sync / async mode.
- **From the replacement**: factory, dependencies, and `lifetime`.
- **Old instances end**: the target and every service that strongly depends on it, including instances in scopes, are evicted and released with dependents first. They are recreated on the next resolution. Old instances still initializing are released as soon as they complete.
- **Lazy consumers are unaffected**: the next `resolve()` on their handle returns the new implementation.
- You can call `override()` before `use()`. The last override of a target wins, and `override(original, original)` restores the original.
- Old instances are released in the background, and cleanup errors are reported by `dispose()`. Application code that still holds an old instance should stop using it.

## Lazy resolution

`lazy()` injects a handle that gets the instance under the target's lifetime only when `resolve()` is called:

```ts
import { lazy, ripple } from 'cyrenex';

const Report = ripple('report', { users: lazy(() => Users) }, ({ users }) => ({
  run: async () => (await users.resolve()).list(),
}));
```

- The callback runs at registration (`use()` / `override()`), may return a Ripple or a Verse, and should be stable and side-effect free.
- Lazy inputs are not strong dependencies and can break dependency cycles. `init()` still initializes singleton lazy targets.
- Calling `resolve()` after the handle's scope closes throws `DisposedError`.

## Eager initialization

```ts
const app = new Cyrene().use(Service);
try {
  await app.init();
  // every registered singleton is ready
} finally {
  await app.dispose();
}
```

`init()` initializes every currently registered singleton, including internal dependencies and lazy targets. It does not pre-create scoped or transient instances.
Cached instances are reused, so it can be called again after registering more services. Failures are reported after every branch settles: one failure is rethrown as is, several become an `AggregateError`.

## Diagnostics and failures

`inspect()` returns a dependency graph snapshot without running factories:

```ts
import { formatGraph } from 'cyrenex';

console.log(formatGraph(app.inspect()));
```

| Field   | Meaning                                                           |
| ------- | ----------------------------------------------------------------- |
| `roots` | Explicitly registered entries                                     |
| `nodes` | Registered keys, their `lifetime`, and instance state in the root |
| `edges` | Consumer, input name, target, and strong / lazy kind              |

In the tree output, `↗` marks an already expanded shared node and `↻` a cycle. ANSI sequences and terminal control characters are removed.

| Failure                          | Behavior                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| Factory fails                    | Throws `ResolutionError`; `path` is the full chain from the entry, `cause` the original error |
| Strong dependency cycle          | Throws `CircularDependencyError` at resolution                                                |
| Unknown key or missing provider  | Throws `InvalidDependencyError`                                                               |
| Async failure                    | Returns a rejected Promise                                                                    |
| Resolving a failed service again | Failures are not cached; the factory runs again                                               |

## Resource disposal

Use `await using`, or call `await app.dispose()` explicitly.
Instances returned with `Symbol.asyncDispose` or `Symbol.dispose` are registered; the former takes precedence:

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

- `dispose()` is idempotent. It rejects new resolutions immediately, closes child scopes, waits for in-flight initialization, then releases resources one by one in reverse completion order. Dependencies complete first, so consumers are released before them.
- The same object is released once. If one cleanup fails, the rest still run, and an `AggregateError` is thrown at the end.
- Plain objects are not registered, and plain `.dispose()` methods are not part of the protocol.
- The container only tracks initialization. Stop and await application work before closing it.

## Cross-package composition

Hosts and plugin packages must share one `cyrenex` module instance. Ripple, Verse, and lazy identities live inside the library, so declarations from another copy, even of the same version, cannot be used.
Plugin packages should list `cyrenex` in `peerDependencies` and mark it external when bundling.

<a id="agent"></a>

## Agent

The npm package ships a [cyrenex skill](./skills/cyrenex/SKILL.md) that helps coding agents use declarations, scopes, overrides, and disposal correctly.

After installing `cyrenex`, use [skills-npm](https://github.com/antfu/skills-npm) to link it to your agent's skill directory:

```sh
npm install -D skills-npm
npx skills-npm setup
```

`setup` detects your agent, runs the first sync, appends the sync command to the `prepare` script in `package.json`, and adds `.gitignore` rules for the generated links.
To sync manually, run `npx skills-npm`.

<a id="development"></a>

## Development

Source lives in [`src/`](./src) and tests in [`tests/`](./tests). The build writes ESM and type declarations to `dist/`.

```sh
vp install
vp run ready
```

| Command        | Purpose                         |
| -------------- | ------------------------------- |
| `vp check`     | Format, lint, and type check    |
| `vp test run`  | Run tests                       |
| `vp pack`      | Build ESM and type declarations |
| `vp run ready` | Run all of the above in order   |

See the [design document](./docs/CYRENE_DESIGN.md) (Chinese) for the implementation structure.
