---
name: cyrenex
description: Use cyrenex to implement or review TypeScript services with typed dependencies, lazy initialization, overrides, singleton or transient lifetimes, and resource disposal. Apply when the project uses Cyrene or the user asks to integrate cyrenex.
---

# Cyrene 服务开发

使用 `cyrenex` 的公开 API 编写服务声明，在应用入口组合容器。先看项目已有的服务声明、容器创建位置和关闭流程，沿用现有边界。

## 选择 API

| 需求         | 写法                                       | 行为                                         |
| ------------ | ------------------------------------------ | -------------------------------------------- |
| 无依赖服务   | `ripple('key', factory)`                   | 保存声明，尚不创建实例                       |
| 有依赖服务   | `ripple('key', { local: Other }, factory)` | 工厂收到解析后的依赖，输入名不必等于服务 key |
| 注册公开入口 | `new Cyrene().use(Service)`                | 自动收集内部依赖，仅显式入口出现在 `ripples` |
| 获取入口     | `app.ripples.service`                      | 同步返回实例，异步返回 Promise               |
| 获取内部依赖 | `app.resolve(Declaration)`                 | 按声明身份解析，保留实例类型                 |
| 测试替身     | `app.override(Original, Replacement)`      | 必须在首次解析前完成                         |
| 延迟访问     | `lazy(() => Target)`                       | 注入句柄，调用 `resolve()` 才初始化目标      |
| 关闭容器     | `await app.dispose()`                      | 等待已接受的初始化，清理 owned 资源          |

`ripple()` 的最后一个可选参数为 `{ lifetime?: 'singleton' | 'transient', ownership?: 'owned' | 'borrowed' }`。
默认是 `singleton` 和 `owned`。不要把选项传给 `new Cyrene()`。

## 完整案例：声明依赖，在入口使用

下面的 TypeScript ESM 代码只依赖 `cyrenex`，不需要外部服务：

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

这里的 `config` 是工厂的输入名，`appConfig` 是声明的 key。只注册 `Users` 就能收集 `Config`，但不会出现 `app.ripples.appConfig`。
工厂中的 `config` 和返回的 `users` 都由 TypeScript 推导，不需要手写容器服务映射。

## 编写服务时遵循的规则

1. 服务间引用同一个 Ripple 声明对象；不要在每次请求中重新创建同 key 的声明。
2. 将依赖放进 `deps` 或 `lazy`。工厂接收依赖实例，不接收容器；不要在工厂中等待同一容器的公共解析或关闭。
3. 在应用组合阶段完成所有 `use()` 和 `override()`，然后才解析、执行任务或接收请求。
4. 链式调用 `use()`，或接住返回值以累积入口类型。独立调用 `app.use(Service)` 不会改变原变量的泛型；动态注册后可用 `resolve(Service)` 保留类型。
5. 保留声明的类型推导。给声明标注宽泛的 `Dependency` 类型会丢失 key 字面量信息。
6. 关闭前先停止并等待业务任务。容器追踪初始化，不追踪服务方法中的请求、流或后台任务。

首次解析尝试就锁定配置，即使解析失败也不能继续注册或覆盖。`inspect()` 只校验和观察依赖图，不执行工厂，也不锁定配置。

## 按场景读取案例

- 编写异步服务、lazy 消费者、测试替身或 transient 工作对象时，读 [具体案例](./references/examples.md)。每个代码块都可独立运行。
- 排查重复 key、循环依赖、覆盖可达性、失败缓存或资源清理顺序时，读 [运行规则](./references/runtime-rules.md)。

异步规则：工厂或任意强依赖异步，解析就返回 Promise；只有 lazy 目标异步时消费者仍可同步。异步单例就绪后仍返回同一个 Promise。
生命周期规则：singleton 在同一容器内共享；transient 每次解析重新执行工厂，不代表请求作用域，也不会在每次调用后自动清理。

## 避免生成不存在的 API

- 注册使用 `use(Service, Other)`，没有 `add()`、对象映射式 `use({ service: Service })` 或 `start()` / `init()`。
- 替换使用 `override(Original, Replacement)`，不能按字符串替换；不支持运行中热替换、`remove()` 或响应式代理。
- 清理使用实例的 `Symbol.dispose` / `Symbol.asyncDispose`。普通 `.dispose()` 方法或 `ripple` 的 `dispose` 选项不会注册清理。
- `resolve(Declaration)` 不能解析有效图之外的声明；先通过入口或依赖把它加入图。

## 验证改动

在消费项目中，用它已有的类型检查与测试命令验证，重点检查返回值是否需要 `await`、覆盖是否发生在解析前、关闭是否被等待。
修改 Cyrene 本仓库时，从根目录运行 `vp run -r build`、`vp check`、`vp test run`；公开类型变更还需验证真实包导入的类型推导。
