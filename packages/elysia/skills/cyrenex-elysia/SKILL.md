---
name: cyrenex-elysia
description: Integrate cyrenex services into Elysia routes with elysiaCyrene and useRipples. Use for typed route dependencies, shared application containers, pre-request overrides, request tests, and container shutdown in projects using @cyrenex/elysia.
---

# Cyrene 与 Elysia 集成

`@cyrenex/elysia` 提供应用级容器和带类型的路由入口。优先复用项目已有的插件实例、路由组织和服务器适配器。
包需要应用安装 `cyrenex` 与 `elysia`，其中 Elysia 满足 `^1.4.0`。

## 完整案例：声明服务，在路由中使用

下面的 TypeScript ESM 示例不启动服务器，通过 `app.handle()` 验证响应：

```ts
import assert from 'node:assert/strict';
import { elysiaCyrene, useRipples } from '@cyrenex/elysia';
import { ripple } from 'cyrenex';
import { Elysia } from 'elysia';

const Greeting = ripple('greeting', () => ({
  greet: (name: string) => `Hello, ${name}!`,
}));
const container = elysiaCyrene();
const app = new Elysia()
  .use(container)
  .use(useRipples(Greeting))
  .get('/hello/:name', ({ ripples, params }) => ripples.greeting.greet(params.name));

try {
  const response = await app.handle(new Request('http://localhost/hello/Ada'));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'Hello, Ada!');
} finally {
  await container.decorator.cyrene.dispose();
}
```

这里的 `ripples.greeting` 和 `params.name` 由插件与路由推导。无需手动扩展 Elysia context 类型，也无需在 handler 中查找字符串 token。

## 插件顺序与容器边界

| 操作                                                         | 用途                               | 注意                                       |
| ------------------------------------------------------------ | ---------------------------------- | ------------------------------------------ |
| `const container = elysiaCyrene()`                           | 创建插件和一个 Cyrene 容器         | 同一应用跨路由复用这个实例                 |
| `.use(container)`                                            | 安装 `cyrene` decorator 和停止钩子 | 放在 useRipples 前                         |
| `.use(useRipples(Service))`                                  | 注册并暴露带类型的 `ripples`       | 放在需要这些入口的路由前                   |
| `ripples.service`                                            | 按需解析服务                       | 同步实例直接使用，异步实例需 await         |
| `container.decorator.cyrene.override(Original, Replacement)` | 测试或环境替换                     | 必须在首次请求或其他解析之前               |
| `await container.decorator.cyrene.dispose()`                 | 等待资源清理                       | handle/fetch 测试由调用方在 finally 中执行 |

- 每次 `elysiaCyrene()` 都创建新容器；不要在同一应用的每个路由模块里分别调用它。
- 每个独立路由模块显式 `.use(container).use(useRipples(...))`，再挂载到主应用，保证类型传播和共享实例都正确。
- 多次 `useRipples()` 累积入口类型；注册本身不执行工厂。只注册业务所需入口，内部依赖自动收集。
- 同声明重复注册幂等；不同声明不能使用相同 key。
- 完成所有模块注册和覆盖后再处理请求。第一次读取服务就锁定配置，不要在 handler 中调用 useRipples、use 或 override。

## 异步服务与请求状态

工厂或任意强依赖异步，`ripples.service` 就是 Promise。使用 async handler，并先 `await ripples.service` 再调用实例方法。
单例在应用容器中共享，包括多个请求同时触发的初始化；独立应用或独立测试应使用独立插件实例。

不要把用户身份、request 或 params 存进共享单例。将这些请求数据作为服务方法参数传入。
`lifetime: 'transient'` 表示每次读取/解析创建实例，不代表每个 HTTP 请求一个实例；同一请求读两次也可能得到两个实例。

## 关闭与测试

- 插件的 `onStop` 会调用 `cyrene.dispose()`。是否等待异步停止钩子取决于 Elysia 适配器。
- 需要确定清理结束时，在停止服务器后显式等待 `container.decorator.cyrene.dispose()`；重复关闭是幂等的。
- 只调用 `handle()` / `fetch()` 的测试没有监听服务器，直接在 finally 中关闭容器，不依赖服务器停止钩子。
- 先停止接收请求并等待业务任务结束，再关闭容器；容器不会追踪方法内的在途任务。

共享异步服务、覆盖依赖的请求测试，以及资源清理的完整案例见 [路由与生命周期案例](./references/examples.md)。按任务读取相关段落。

## 常见错误

- 导出名称是 `elysiaCyrene`，不是 `ElysiaCyrene`；当前 API 不接受容器或配置参数。
- `useRipples(Service, Other)` 接收声明列表，不接收对象映射或已经创建的服务实例。
- 不要展开、枚举或 JSON 序列化 `ripples` 来读取服务。它是按属性读取的只读视图；检查图使用 `cyrene.inspect()`。
- 注册了服务 A 的依赖 B，不意味着路由可以读取 `ripples.b`。需要公开 B 时显式加入 useRipples。
- 工厂通过 deps/lazy 表达服务依赖；请求参数通过业务方法传递。不要从工厂回调等待同一容器的公共解析。

## 验证

验证实际路由响应、异步类型推导、共享实例与 finally 清理。使用消费项目已有测试工具和适配器，不为接入插件更换运行时。
修改本仓库时，先 `vp run -r build`，再 `vp check` 和 `vp test run`；包导出测试应通过 `@cyrenex/elysia` 导入。
