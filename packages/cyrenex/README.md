<h1 align="center">Cyrene</h1>

<p align="center">TypeScript 依赖注入库，支持按需初始化、类型推导和资源清理。</p>

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

- **依赖显式** - 用 `ripple()` 描述依赖和工厂, 普通输入值原样传递
- **类型推导** - 工厂输入与实例类型自动推导, 链式 `use()` 累积公开入口的 key 类型
- **异步初始化** - 独立分支并行执行, 并发解析共享同一次单例初始化
- **首次解析前替换** - `override()` 更换尚未执行的配方, 首次解析前自动校验完整依赖图
- **延迟解析** - `lazy()` 提供解析句柄, 按目标生命周期创建实例
- **统一清理** - 按首次创建完成的逆序释放资源, 支持 Symbol 清理协议和 `await using`

## 统一初始化

可以继续按需解析，也可以在开始接收请求或运行任务前显式预热：

```ts
const app = new Cyrene().use(Service);
try {
  await app.init();
  // 所有可达 singleton 已就绪，可以开始业务工作。
} finally {
  await app.dispose();
}
```

`init(): Promise<void>` 初始化整个有效依赖图中的 singleton，包括内部依赖和 lazy 目标；复用已经开始或完成的初始化。
它不额外预创建 transient，但 singleton 的强依赖仍按正常规则创建 transient，以 override 后的 lifetime 为准。

调用时立即锁定配置，先校验完整依赖图，再并发启动独立分支。重复调用复用同一个 Promise，包括失败结果。
所有批次分支结束后才报告失败，不自动回滚或重试；失败后仍需 `dispose()` 清理资源。
`dispose()` 会等待已接受的初始化批次，关闭开始后调用 `init()` 返回拒绝的 Promise。
不要在工厂中等待同一容器的 `init()`，否则会等待自身完成。

## 声明与实例

**先声明, 再注册, 按需解析**

```text
ripple(key, factory)       → 描述如何创建服务
new Cyrene().use(Service)  → 注册公开入口, 自动收集依赖
app.ripples.service       → 获取实例, 首次访问时初始化
await app.dispose()       → 等待初始化结束, 释放资源
```

- **声明** — `ripple(key, factory)` 或 `ripple(key, deps, factory)`, key 是不可变的非空字符串
- **依赖** — 引用 Ripple 对象, 输入属性名可以与目标 key 不同
- **普通输入** — 原样传入工厂, 包括嵌套对象和普通 Promise

| 生命周期           | 创建与复用                               |
| ------------------ | ---------------------------------------- |
| `singleton` (默认) | 同一容器共享实例, 并发初始化共享 Promise |
| `transient`        | 每次解析重新执行工厂                     |

## 注册与依赖

`use()` 只决定公开入口, 内部依赖会自动收集:

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
app.resolve(Config).prefix; // 内部依赖, 通过声明获取
// app.ripples.config 不存在
```

需要更多公开入口时, 可以写成 `new Cyrene().use(Users).use(Logger, Config)`

> [!TIP]
> 链式调用或接住 `use()` 的返回值, 才能累积公开 key 的类型
> 动态追加后, 仍可通过 `resolve(Ripple)` 获得精确的实例类型

<details>
<summary>声明身份与注册规则</summary>

- `use()` 修改并返回同一个容器, 整批入口验证通过后才登记
- 同一声明重复注册幂等; 不同声明在有效图中使用相同 key 会报错
- 显式注册内部依赖可将其提升为公开入口
- `resolve(Ripple)` 按声明身份查找; `resolve(key)` 也能访问内部节点, 但未累积类型的 key 返回 `unknown`
- `isRipple()` 可以识别由当前库创建的声明

复用声明逻辑时, 用普通函数创建具有不同 key 的 Ripple:

```ts
const logger = <const K extends string>(key: K, scope: string) => ripple(key, () => ({ scope }));

const app = new Cyrene().use(logger('auditLogger', 'audit'), logger('requestLogger', 'request'));
```

</details>

## 按 key 声明依赖契约

`verse<T>(key)` 声明同步契约，`verseAsync<T>(key)` 声明异步契约。消费者只需要契约，不需要提供方的 Ripple 对象：

```ts
import { Cyrene, ripple, verse, verseAsync } from 'cyrenex';

interface AgentOptions {
  prefix: string;
}

const AgentConfig = verse<AgentOptions>('agentConfig');
const Database = verseAsync<{ query(): string[] }>('database');
const Agent = ripple(
  'agent',
  { config: AgentConfig, database: Database },
  ({ config, database }) => ({
    list: () => database.query().map(name => `${config.prefix}: ${name}`),
  }),
);

function agentConfigPlugin(options: AgentOptions) {
  return ripple(AgentConfig, () => options);
}

const DatabasePlugin = ripple(Database, async () => ({ query: () => ['Alice'] }));
const app = new Cyrene().use(agentConfigPlugin({ prefix: 'app' }), DatabasePlugin, Agent);

const agent = await app.ripples.agent;
agent.list(); // ['app: Alice']
await app.dispose();
```

提供方也可以继续写 `ripple('agentConfig', () => options)`。按 key 关联，不要求消费者和提供方使用同一个 verse 对象；`ripple(AgentConfig, factory)` 则额外校验工厂返回类型。

| 契约                 | 实现要求             | 解析结果     |
| -------------------- | -------------------- | ------------ |
| `verse<T>(key)`      | 工厂和全部强依赖同步 | `T`          |
| `verseAsync<T>(key)` | 同步或异步实现       | `Promise<T>` |

工厂收到已解析的依赖实例。强依赖包含 `verseAsync` 时，消费者也返回 Promise；同步实现通过异步契约访问时，其字符串或 Ripple 入口仍保持原来的同步行为。

- 实现必须已经通过 `use()` 或其他 Ripple 的依赖进入有效图；verse 本身不能注册，也不会自动创建实现。
- 注册顺序不影响查找。缺失实现、重复 key 和强依赖环在构图时报告；`override()` 后仍按原 key 查找有效实现。
- 同步契约的异步冲突在构图时检查；普通函数动态返回 Promise 的情况在解析时拒绝，不会把 Promise 注入同步消费者。
- `app.resolve(AgentConfig)` / `app.resolve(Database)` 保留契约类型。字符串提供方的结果类型无法与独立契约静态核对，`T` 由调用方保证。

<details>
<summary>保留提供方的 key 字面量类型</summary>

TypeScript 显式指定 `T` 后不会继续推导带默认值的 key 类型参数。需要让 `ripple(verse, factory)` 累积精确的公开属性名时，同时指定 key 类型：

```ts
const AgentConfig = verse<AgentOptions, 'agentConfig'>('agentConfig');
const app = new Cyrene().use(ripple(AgentConfig, () => ({ prefix: 'app' })));
app.ripples.agentConfig.prefix;
```

只写 `verse<AgentOptions>('agentConfig')` 时，key 类型为 `string`；可使用 `resolve(AgentConfig)` 获取精确实例类型，或用字符串定义提供方以保留 key 推导。

</details>

## 首次解析前替换

通过原声明指定替换目标, 公开入口与内部依赖使用同一规则:

```ts
const MockConfig = ripple('mockConfig', () => ({ prefix: 'test' }));
const app = new Cyrene().use(Users).override(Config, MockConfig);

app.ripples.users.describe(); // [test] users
app.resolve(Config) === app.resolve(MockConfig); // 同一单例
```

- **保持不变** — 原 key、公开范围、返回值与同步 / 异步契约
- **使用替身** — 工厂、依赖与 `lifetime`
- **锁定时机** — 第一次读取属性、调用 `resolve()` 或 `init()`, 即使初始化失败也不解锁

<details>
<summary>覆盖顺序与可达性</summary>

- 允许先 `override()` 后 `use()`; 同一目标最后一次覆盖生效
- `override(original, original)` 恢复原实现
- 构图只收集有效实现的依赖, 原实现独有的依赖被裁剪
- 覆盖目标必须在有效图中可达, 被上层覆盖裁剪掉的目标也会报错
- 同一个替身只能代表一个注册项, 不能同时占据其他入口或依赖节点
- 原声明与当前替身都可解析; 已被替换掉的旧替身不再映射到该节点

</details>

## 同步与异步

**强依赖先就绪, 工厂再执行**

```ts
const Config = ripple('config', () => ({ name: 'demo' }));
const Database = ripple('database', async () => ({ query: () => ['Alice'] }));
const Users = ripple('users', { database: Database }, ({ database }) => ({
  list: () => database.query(),
}));

await using app = new Cyrene().use(Config, Users);

app.ripples.config.name; // 同步, 直接返回实例
const users = await app.ripples.users; // 强依赖异步, 等待初始化
users.list();
```

| 情况                       | 解析结果                               |
| -------------------------- | -------------------------------------- |
| 工厂与全部强依赖同步       | 直接返回实例                           |
| 工厂或任意强依赖异步       | 返回 Promise, 工厂收到已就绪的依赖     |
| 只有 lazy 目标异步         | 消费者保持同步, 句柄解析时返回 Promise |
| 工厂返回 `T \| Promise<T>` | 保留联合类型                           |

属性入口只读, 服务实例本身不代理; 异步单例完成后仍返回同一个 Promise

## 延迟解析

按需解析时，`lazy()` 注入解析句柄，调用句柄的 `resolve()` 时创建目标；`init()` 也会主动初始化其中的 singleton：

```ts
import { lazy, ripple } from 'cyrenex';

const Report = ripple('report', { users: lazy(() => Users) }, ({ users }) => ({
  run: async () => (await users.resolve()).list(),
}));
```

- 回调只返回声明, 保持稳定且无副作用
- 回调在构图时求值, 配置未变更时复用结果
- 工厂通过 deps / lazy 表达依赖, 避免等待同一容器的公共解析或关闭操作

<details>
<summary>初始化期间的 Promise 与等待环</summary>

| 操作                              | 是否登记等待关系           |
| --------------------------------- | -------------------------- |
| 仅调用异步 `lazy.resolve()`       | 否, 只启动初始化           |
| `await` 或返回给异步工厂          | 是                         |
| 调用 `then` / `catch` / `finally` | 是, 包括仅观察结果的回调链 |

初始化期间, 同一句柄按目标实例复用 Promise 包装, 与公共入口的 Promise 身份不同
消费者就绪后, 句柄直接返回目标的解析结果

强依赖环在构图时拒绝, 实际的异步等待环在初始化时拒绝

</details>

## Transient 与创建时机

`transient` 适合每次任务独立的收集器、构建器等工作对象:

```ts
const Job = ripple('job', () => ({ messages: [] as string[] }), { lifetime: 'transient' });
const Worker = ripple('worker', { job: Job }, ({ job }) => ({ job }));

await using app = new Cyrene().use(Worker);

app.resolve(Job) !== app.resolve(Job); // 每次解析都创建
app.ripples.worker.job === app.ripples.worker.job; // singleton 持有首次注入
```

| 操作                       | transient 的创建时机                 |
| -------------------------- | ------------------------------------ |
| 声明、注册、覆盖、检查图   | 不执行工厂                           |
| 读取属性或调用 `resolve()` | 每次解析创建                         |
| 注入强依赖                 | 消费者初始化时, 每个输入属性分别创建 |
| `lazy.resolve()`           | 每次调用创建, 仅注入句柄不创建       |
| 并发异步解析               | 独立初始化, 返回不同 Promise         |

> [!NOTE]
> transient 保证重新执行工厂; 工厂主动返回同一对象时不会复制它
> 带 Symbol 清理协议的 owned 实例保留到容器关闭, 长期运行时需控制此类资源的创建数量

更多关于失败重试、递归创建与状态记录的规则见 [解析设计](./docs/CYRENE_DESIGN.md#解析)

## 诊断与失败处理

`inspect()` 校验依赖图并返回快照, **不执行工厂, 也不锁定配置**:

```ts
import { formatGraph } from 'cyrenex';

console.log(formatGraph(app.inspect()));
```

| 快照字段 | 含义                                       |
| -------- | ------------------------------------------ |
| `roots`  | 显式注册的公开入口                         |
| `nodes`  | 完整有效图中的 key 与最近一次初始化状态    |
| `edges`  | 消费者、输入属性、目标与强依赖 / lazy 策略 |

树形输出中, `↗` 表示共享节点, `↻` 表示循环引用; ANSI 序列和终端控制字符会被清除

| 失败场景                       | 行为               |
| ------------------------------ | ------------------ |
| 图无效、入口无效或同步创建失败 | 直接抛错           |
| 异步创建失败                   | Promise 拒绝       |
| singleton 初始化失败           | 缓存失败结果       |
| transient 初始化失败           | 下一次解析重新尝试 |

**失败后仍由调用方关闭容器**, 释放已经登记的待清理资源

## 资源释放

用 `await using` 自动关闭容器（需要运行时或 TypeScript 工具链支持），或显式调用 `await app.dispose()`
资源在工厂返回时声明 `Symbol.asyncDispose` 或 `Symbol.dispose`, 前者优先:

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

示例中的 `openConnection` 由应用选择的数据库驱动提供

| 实例                    | 资源表如何处理                           |
| ----------------------- | ---------------------------------------- |
| owned + Symbol 清理协议 | 保留到关闭, 按首次创建完成的逆序释放     |
| 普通对象                | 只弱引用记录所有权, 无其他引用时可回收   |
| `ownership: 'borrowed'` | 由应用管理, 容器不负责清理               |
| 同一对象重复返回        | 只清理一次; 混用 owned / borrowed 会报错 |

> [!TIP]
> 应用先停止接收业务任务并等待已有任务结束, 再关闭容器
> 容器会等待已接收的初始化, 业务方法、流和后台任务由应用管理

<details>
<summary>关闭顺序与责任边界</summary>

- `dispose()` 幂等, 立即关闭新解析入口, 等待已接收的初始化结束后清理资源
- 强依赖通常先完成, 消费者先清理; 后来激活的 lazy 和对象别名按实际首次完成顺序处理
- 清理失败后继续处理其他资源, 最后聚合报告错误
- singleton 的解析缓存仍持有结果; 资源表的弱引用不改变单例缓存
- 普通 `.dispose()` 和选项式清理回调不参与协议
- transient 不提供请求级作用域或每次调用后的自动释放
- 工厂抛错前已分配但尚未交付的资源, 由工厂自行清理

</details>

<a id="agent"></a>

## Agent

Cyrene 随 npm 包提供 [cyrenex skill](./skills/cyrenex/SKILL.md), 帮助编码 Agent 正确使用声明注册, 首次解析前替换, 延迟解析和资源释放

在使用 Cyrene 的项目中安装 `cyrenex` 后, 可以通过 [skills-npm](https://github.com/antfu/skills-npm) 将 skill 链接到 Agent 的技能目录:

```sh
npm install -D skills-npm
npx skills-npm setup
```

`setup` 会自动检测 Agent, 完成首次同步, 并将同步命令追加到 `package.json` 的 `prepare` 脚本, 同时为生成的链接添加 `.gitignore` 规则
之后安装或更新依赖时会自动同步, 让 skill 随项目使用的包版本一起更新

如果只想手动同步, 可以运行:

```sh
npx skills-npm
```

<a id="development"></a>

## 开发

实现放在 [`src/`](./src), 测试放在 [`tests/`](./tests), 构建输出 ESM 与类型声明到 `dist/`

```sh
vp install
vp run ready
```

| 命令           | 用途                   |
| -------------- | ---------------------- |
| `vp check`     | 格式, lint 与类型检查  |
| `vp test run`  | 运行测试               |
| `vp pack`      | 构建 ESM 与类型声明    |
| `vp run ready` | 依次执行以上检查与构建 |

欢迎从 [设计文档](./docs/CYRENE_DESIGN.md) 和 [测试用例](./tests/) 了解行为边界
