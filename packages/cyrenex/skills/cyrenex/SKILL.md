---
name: cyrenex
description: Use cyrenex to implement or review TypeScript services with typed dependencies, lazy initialization, singleton / scoped / transient lifetimes, scopes, runtime overrides, and resource disposal. Apply when the project uses Cyrene or the user asks to integrate cyrenex.
---

# Cyrene 服务开发

使用 `cyrenex` 的公开 API 编写服务声明，在应用入口组合容器。先看项目已有的服务声明、容器创建位置和关闭流程，沿用现有边界。

## 选择 API

| 需求         | 写法                                       | 行为                                                   |
| ------------ | ------------------------------------------ | ------------------------------------------------------ |
| 无依赖服务   | `ripple('key', factory)`                   | 保存声明，尚不创建实例                                 |
| 有依赖服务   | `ripple('key', { local: Other }, factory)` | 工厂收到解析后的依赖，输入名不必等于服务 key           |
| 注册公开入口 | `app.use(Service)`                         | 自动收集内部依赖；可以在解析之后继续调用               |
| 获取入口     | `app.ripples.service`                      | 同步返回实例，异步返回 Promise                         |
| 获取内部依赖 | `app.resolve(Declaration)`                 | 按声明身份解析，保留实例类型                           |
| 作用域       | `const s = app.scope()`                    | scoped 服务在作用域内复用，`await s.dispose()` 释放    |
| 统一初始化   | `await app.init()`                         | 初始化已注册的所有 singleton，包括 lazy 目标           |
| 替换实现     | `app.override(Original, Replacement)`      | 随时可用；结束目标及其依赖者的旧实例，下次解析时重建   |
| 延迟访问     | `lazy(() => Target)`                       | 注入句柄，调用 `resolve()` 时才解析                    |
| 关闭容器     | `await app.dispose()`                      | 关闭作用域，等待初始化，按逆序清理带 Symbol 协议的资源 |

`ripple()` 的最后一个可选参数是 `{ lifetime?: 'singleton' | 'scoped' | 'transient' }`，默认为 `singleton`。不要把选项传给 `new Cyrene()`。

## 生命周期

- `singleton`：缓存在根容器，所有作用域共享。
- `scoped`：每个作用域缓存一份，根容器也视为一个作用域。适合请求级状态，例如事务、当前用户、请求日志。
- `transient`：每次解析都新建。带清理协议的实例归发起解析的作用域，作用域关闭时释放。

singleton 不能依赖 scoped，无论是直接、经由 transient 还是通过 lazy，否则会抛出 `InvalidDependencyError`。需要请求数据的服务应声明为 scoped，或者把请求数据作为方法参数传入。

## 按 key 解耦依赖

消费者用 `verse<T>('key')` 声明同步契约，再放进 ripple 的 deps。提供方写 `ripple('key', factory)`，或写 `ripple(Contract, factory)` / `ripple(Contract, deps, factory)` 来校验返回类型。

契约按 key 查找实现，实现必须通过 `use()` 或其他 Ripple 的依赖注册进来；缺失的实现在解析时才报错。实现必须同步返回，`T` 不能包含 Promise（类型检查时报错），运行时解析结果是 Promise 也会抛错；需要异步初始化的服务应直接依赖它的 Ripple 声明。显式指定 `T` 时 key 类型默认是 `string`，需要保留字面量 key 时写 `verse<T, 'key'>('key')`。

## 完整案例

```ts
import { Cyrene, ripple } from 'cyrenex';

const Config = ripple('appConfig', () => ({ greeting: 'Hello' }));
const Users = ripple('users', { config: Config }, ({ config }) => ({
  greet: (name: string) => `${config.greeting}, ${name}!`,
}));

const app = new Cyrene().use(Users);

try {
  console.log(app.ripples.users.greet('Ada')); // Hello, Ada!
  console.log(app.resolve(Config).greeting); // Hello
} finally {
  await app.dispose();
}
```

`config` 是工厂的输入名，`appConfig` 是声明的 key。只注册 `Users` 也会收集 `Config`，但不会出现 `app.ripples.appConfig`。

## 编写服务时遵循的规则

1. 直接依赖使用同一个 Ripple 声明对象；按 key 解耦时使用 verse。不要在每次请求中重新创建同 key 的声明。
2. 依赖写进 `deps` 或 `lazy`。工厂接收依赖实例，不接收容器；不要在工厂中等待同一容器的 `init()` 或 `dispose()`。
3. 请求级服务用 `scoped` 加 `app.scope()`，每个请求一个作用域，结束时 `await scope.dispose()`。
4. 链式调用 `use()` 或接住返回值来累积入口类型。独立调用 `app.use(Service)` 不会改变原变量的泛型，这时可以用 `resolve(Service)` 保留类型。
5. `override()` 之后，旧实例会被释放。不要在业务代码里长期持有服务实例，应在需要时从容器或 lazy 句柄获取。
6. 关闭前先停止并等待业务任务。容器只追踪初始化，不追踪服务方法中的请求、流或后台任务。

## 按场景读取

- 编写异步服务、lazy 消费者、作用域、测试替身或运行时替换时，读 [具体案例](./references/examples.md)。
- 排查循环依赖、作用域错误、失败重试或清理顺序时，读 [运行规则](./references/runtime-rules.md)。

## 避免生成不存在的 API

- 注册用 `use(Service, Other)`，没有 `add()`、对象映射式 `use({ service: Service })` 或 `start()`，也没有 `remove()`。
- 替换用 `override(Original, Replacement)`，不能按字符串替换。替身只能通过原声明或 key 解析。
- 作用域只能由 `Cyrene` 的 `scope()` 创建；作用域本身没有 `use`、`override`、`init`、`scope`。
- 清理使用实例的 `Symbol.dispose` / `Symbol.asyncDispose`。普通 `.dispose()` 方法或 `ripple` 的 `dispose` 选项不会注册清理。
- `resolve()` 不会自动注册未知声明，先通过 `use()` 或依赖把它加入注册表。

## 验证改动

在消费项目中，使用它已有的类型检查与测试命令，重点检查返回值是否需要 `await`、scoped 是否被 singleton 依赖、作用域和容器是否被关闭。
修改 Cyrene 本仓库时，从根目录运行 `vp run -r build`、`vp check`、`vp test run`。
