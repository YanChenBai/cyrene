<h1 align="center">Cyrene</h1>

<p align="center">TypeScript 依赖注入库，支持按需初始化、作用域、运行时替换和资源清理。</p>

<p align="center">简体中文 · <a href="./README.en.md">English</a></p>

<p align="center">
  <a href="#quick-start">快速上手</a> ·
  <a href="#features">功能</a> ·
  <a href="#agent">Agent</a> ·
  <a href="./docs/CYRENE_DESIGN.md">设计文档</a> ·
  <a href="#development">开发</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyrenex"><img src="https://img.shields.io/npm/v/cyrenex?style=flat&labelColor=18212f&color=a78bfa" alt="npm 版本" /></a>
  <img src="https://img.shields.io/badge/module-ESM-a78bfa?style=flat&labelColor=18212f" alt="ESM" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.6.0-5fa777?style=flat&labelColor=18212f" alt="Node.js 22.6.0 及以上" />
</p>

<a id="quick-start"></a>

## 快速上手

需要 Node.js 22.6.0 及以上，提供 ESM 入口和 TypeScript 类型声明。

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

`ripple()` 声明服务，`use()` 注册入口，首次读取 `ripples` 时创建实例。
同步服务直接返回实例，异步服务返回 Promise。

<a id="features"></a>

## 功能

- **依赖显式**：用 `ripple()` 描述依赖和工厂，普通输入值原样传递
- **类型推导**：工厂输入和实例类型自动推导，链式 `use()` 累积公开入口的 key 类型
- **异步初始化**：依赖并行初始化，并发解析共享同一次单例初始化
- **三种生命周期**：`singleton`、`scoped`、`transient`，`app.scope()` 创建作用域
- **随时注册与替换**：`use()` 可在解析后追加；`override()` 会结束目标及依赖它的实例
- **延迟解析**：`lazy()` 注入解析句柄，可以引用后定义的声明
- **统一清理**：按完成顺序的逆序释放资源，支持 Symbol 清理协议和 `await using`

## 声明与注册

```text
ripple(key, factory)       → 描述如何创建服务
new Cyrene().use(Service)  → 注册公开入口，自动收集依赖
app.ripples.service        → 获取实例，首次访问时初始化
await app.dispose()        → 等待初始化结束，释放资源
```

`use()` 只决定哪些是公开入口，内部依赖会自动收集：

```ts
const Config = ripple('config', () => ({ prefix: 'app' }));
const Logger = ripple('logger', { config: Config }, ({ config }) => ({
  format: (message: string) => `[${config.prefix}] ${message}`,
}));
const Users = ripple('users', { logger: Logger }, ({ logger }) => ({
  describe: () => logger.format('users'),
}));

const app = new Cyrene().use(Users);

app.ripples.users.describe(); // 公开入口
app.resolve(Config).prefix; // 内部依赖，通过声明获取
// app.ripples.config 不存在
```

- 依赖引用 Ripple 对象，输入属性名可以与目标 key 不同；普通输入（包括嵌套对象和 Promise）原样传入工厂。
- 同一声明重复注册是幂等的；不同声明使用相同 key 会报错。
- `use()` 可以在解析之后继续调用，已有作用域也能看到新入口。
- `resolve(Ripple)` 按声明身份查找，`resolve(key)` 按 key 查找，也能访问内部依赖；未累积类型的 key 返回 `unknown`。

> [!TIP]
> 链式调用或接住 `use()` 的返回值，才能累积公开 key 的类型。
> 后续追加的入口可以通过 `resolve(Ripple)` 获得精确的实例类型。

复用声明逻辑时，用普通函数创建不同 key 的 Ripple：

```ts
const logger = <const K extends string>(key: K, scope: string) => ripple(key, () => ({ scope }));

const app = new Cyrene().use(logger('auditLogger', 'audit'), logger('requestLogger', 'request'));
```

## 同步与异步

```ts
const Config = ripple('config', () => ({ name: 'demo' }));
const Database = ripple('database', async () => ({ query: () => ['Alice'] }));
const Users = ripple('users', { database: Database }, ({ database }) => ({
  list: () => database.query(),
}));

await using app = new Cyrene().use(Config, Users);

app.ripples.config.name; // 同步，直接返回实例
const users = await app.ripples.users; // 依赖是异步的，返回 Promise
users.list();
```

| 情况                       | 解析结果                               |
| -------------------------- | -------------------------------------- |
| 工厂与全部强依赖同步       | 直接返回实例                           |
| 工厂或任意强依赖异步       | 返回 Promise，工厂收到已就绪的依赖     |
| 只有 lazy 目标异步         | 消费者保持同步，句柄解析时返回 Promise |
| 工厂返回 `T \| Promise<T>` | 保留联合类型                           |

异步单例在初始化期间和完成后都返回同一个 Promise。

## 生命周期与作用域

| 生命周期           | 缓存位置                       | 资源归属         |
| ------------------ | ------------------------------ | ---------------- |
| `singleton` (默认) | 根容器，所有作用域共享         | 根容器           |
| `scoped`           | 每个作用域一份，根容器也算一个 | 所在作用域       |
| `transient`        | 不缓存，每次解析都新建         | 发起解析的作用域 |

```ts
const Db = ripple('db', () => openDb());
const Session = ripple('session', { db: Db }, ({ db }) => db.session(), { lifetime: 'scoped' });

const app = new Cyrene().use(Session);

{
  await using request = app.scope();
  request.ripples.session === request.ripples.session; // 同一作用域内复用
} // 作用域关闭时释放它拥有的 session

await app.dispose(); // 先关闭仍存活的作用域，再释放根容器资源
```

- `app.scope()` 返回的作用域与根容器共享注册表和 singleton，只有 `ripples`、`resolve()`、`dispose()`。
- singleton 不能直接依赖、经由 transient 间接依赖或通过 lazy 解析 scoped 服务，否则抛出 `InvalidDependencyError`。
- 带清理协议的 transient 实例归发起解析的作用域，作用域关闭时释放。按请求创建作用域，可以避免这类资源一直积累到容器关闭。

## 按 key 声明依赖契约

`verse<T>(key)` 声明一个按 key 查找实现的同步契约。消费者只需要契约，不需要提供方的 Ripple 对象：

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

- 契约按 key 查找实现，不要求是同一个 verse 对象。提供方可以写 `ripple('agentConfig', factory)`，也可以写 `ripple(AgentConfig, factory)`，后者会额外校验返回类型。
- 实现必须通过 `use()` 或其他 Ripple 的依赖进入注册表。由于允许动态注册，缺失的实现要到解析时才会报错。
- 实现必须同步返回。`T` 不能包含 Promise，`verse<Promise<X>>` 会在类型检查时报错；运行时解析结果是 Promise 时抛出 `InvalidDependencyError`。需要异步初始化的服务，直接依赖它的 Ripple 声明，或让实现同步返回一个内部处理异步操作的对象。
- 显式指定 `T` 后 key 类型默认为 `string`。需要累积精确的公开属性名时，写成 `verse<AgentOptions, 'agentConfig'>('agentConfig')`。

## 替换实现

`override(original, replacement)` 以原声明定位目标，可以在任何时候调用：

```ts
const MockConfig = ripple('mockConfig', () => ({ prefix: 'test' }));
const app = new Cyrene().use(Users);

app.ripples.users.describe(); // [app] users
app.override(Config, MockConfig);
app.ripples.users.describe(); // [test] users，Users 已重新创建
```

- **保持不变**：原 key 和公开范围。类型上要求替身兼容原声明的返回值和同步 / 异步性。
- **来自替身**：工厂、依赖和 `lifetime`。
- **结束旧实例**：目标及所有强依赖它的服务（包括各作用域中的实例）会被移出缓存，并按依赖者在前的顺序释放，下次解析时重新创建。仍在初始化中的旧实例会在完成后立即释放。
- **lazy 消费者不受影响**：句柄下次 `resolve()` 时会拿到新实现。
- 可以先 `override()` 后 `use()`；同一目标以最后一次覆盖为准；`override(original, original)` 恢复原实现。
- 释放旧实例是在后台进行的，清理错误会汇总到 `dispose()` 的结果里。已经交给业务代码的旧实例引用仍可能被继续使用，需要由应用避免。

## 延迟解析

`lazy()` 注入一个解析句柄，调用 `resolve()` 时才按目标的生命周期获取实例：

```ts
import { lazy, ripple } from 'cyrenex';

const Report = ripple('report', { users: lazy(() => Users) }, ({ users }) => ({
  run: async () => (await users.resolve()).list(),
}));
```

- 回调在注册（`use()` / `override()`）时求值，可以返回 Ripple 或 Verse，应保持稳定且无副作用。
- lazy 不建立强依赖，可以用来打破依赖环；`init()` 也会初始化 lazy 目标中的 singleton。
- 句柄所属的作用域关闭后，再调用 `resolve()` 会抛出 `DisposedError`。

## 统一初始化

```ts
const app = new Cyrene().use(Service);
try {
  await app.init();
  // 所有已注册的 singleton 已就绪
} finally {
  await app.dispose();
}
```

`init()` 初始化当前已注册的所有 singleton，包括内部依赖和 lazy 目标，不预创建 scoped 和 transient。
已缓存的实例会直接复用，所以动态注册后可以再次调用。所有分支结束后才报告失败：只有一个失败时抛出原错误，多个失败时抛出 `AggregateError`。

## 诊断与失败处理

`inspect()` 返回依赖图快照，不执行工厂：

```ts
import { formatGraph } from 'cyrenex';

console.log(formatGraph(app.inspect()));
```

| 快照字段 | 含义                                            |
| -------- | ----------------------------------------------- |
| `roots`  | 显式注册的公开入口                              |
| `nodes`  | 已注册的 key、`lifetime` 以及根容器中的实例状态 |
| `edges`  | 消费者、输入属性、目标以及强依赖 / lazy 类型    |

树形输出中，`↗` 表示已展开的共享节点，`↻` 表示循环引用；ANSI 序列和终端控制字符会被清除。

| 失败场景           | 行为                                                                          |
| ------------------ | ----------------------------------------------------------------------------- |
| 工厂失败           | 抛出 `ResolutionError`，`path` 为从入口到失败服务的完整链路，`cause` 为原错误 |
| 强依赖环           | 解析时抛出 `CircularDependencyError`                                          |
| 未知 key、缺失实现 | 抛出 `InvalidDependencyError`                                                 |
| 异步失败           | 返回被拒绝的 Promise                                                          |
| 再次解析失败的服务 | 失败不缓存，会重新执行工厂                                                    |

## 资源释放

用 `await using` 自动关闭，或者显式调用 `await app.dispose()`。
工厂返回的实例实现了 `Symbol.asyncDispose` 或 `Symbol.dispose` 时会被登记，前者优先：

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

- `dispose()` 是幂等的。它会立即拒绝新的解析，先关闭子作用域，等待进行中的初始化，再按完成顺序的逆序逐个释放。依赖先完成，所以消费者会先于依赖被释放。
- 同一对象只释放一次。某个资源清理失败后会继续清理其余资源，最后抛出 `AggregateError`。
- 普通对象不登记；普通 `.dispose()` 方法不参与清理协议。
- 容器只追踪初始化。应用应先停止并等待业务任务，再关闭容器。

## 跨包组合

宿主与能力包需要共享同一份 `cyrenex` 模块实例。Ripple、Verse 和 lazy 的身份保存在库内部，即使版本相同，不同副本创建的声明也不能互相使用。
能力包应将 `cyrenex` 放入 `peerDependencies`，并在打包时标记为 external。

<a id="agent"></a>

## Agent

Cyrene 随 npm 包提供 [cyrenex skill](./skills/cyrenex/SKILL.md)，帮助编码 Agent 正确使用声明、作用域、替换和资源释放。

在使用 Cyrene 的项目中安装 `cyrenex` 后，可以通过 [skills-npm](https://github.com/antfu/skills-npm) 将 skill 链接到 Agent 的技能目录：

```sh
npm install -D skills-npm
npx skills-npm setup
```

`setup` 会自动检测 Agent，完成首次同步，并将同步命令追加到 `package.json` 的 `prepare` 脚本，同时为生成的链接添加 `.gitignore` 规则。
如果只想手动同步，可以运行 `npx skills-npm`。

<a id="development"></a>

## 开发

实现放在 [`src/`](./src)，测试放在 [`tests/`](./tests)，构建输出 ESM 与类型声明到 `dist/`。

```sh
vp install
vp run ready
```

| 命令           | 用途                   |
| -------------- | ---------------------- |
| `vp check`     | 格式、lint 与类型检查  |
| `vp test run`  | 运行测试               |
| `vp pack`      | 构建 ESM 与类型声明    |
| `vp run ready` | 依次执行以上检查与构建 |

实现结构见 [设计文档](./docs/CYRENE_DESIGN.md)。
