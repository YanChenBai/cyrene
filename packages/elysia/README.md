<h1 align="center">@cyrenex/elysia</h1>

<p align="center">在 Elysia 路由中使用 Cyrene 服务，保留类型推导和资源清理。</p>

<p align="center">简体中文 · <a href="./README.en.md">English</a></p>

<p align="center">
  <a href="#quick-start">快速上手</a> ·
  <a href="#shared-routes">多路由共享</a> ·
  <a href="#lifecycle">生命周期</a> ·
  <a href="../cyrenex/README.md">核心包</a> ·
  <a href="#agent">Agent</a> ·
  <a href="#development">开发</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cyrenex/elysia"><img src="https://img.shields.io/npm/v/@cyrenex/elysia?style=flat&labelColor=18212f&color=a78bfa" alt="npm 版本" /></a>
  <img src="https://img.shields.io/badge/module-ESM-a78bfa?style=flat&labelColor=18212f" alt="ESM" />
</p>

<a id="quick-start"></a>

## 快速上手

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

`cyrenex` 与 `elysia` 是由应用安装的 peer dependencies，Elysia 版本需满足 `^1.4.0`。
示例通过 `app.handle()` 处理请求，不启动监听服务器。

## 注册与解析

`elysiaCyrene()` 创建一个容器，通过 `context.cyrene` 和 `app.decorator.cyrene` 暴露。
`useRipples(...declarations)` 注册入口，并为后续路由提供带类型的 `context.ripples`。
必须先安装 `elysiaCyrene()`，再调用 `useRipples()`。

- 注册不会运行工厂，首次读取属性才解析依赖。
- 同步入口返回实例，异步入口返回 `Promise`；异步路由请使用 `async` / `await`。
- 多次 `useRipples()` 会累积入口类型；同一声明可以重复注册，不同声明不能占用相同 key。
- 间接依赖自动收集，只有显式注册的入口会作为 `ripples` 属性公开。
- 首次解析后依赖图锁定，所有注册和 `cyrene.override()` 都应在处理请求前完成。
- `ripples` 是只读属性访问视图，不支持通过 `Object.keys()`、展开运算符或 JSON 序列化列出服务；查看依赖图请用 `cyrene.inspect()`。

<a id="shared-routes"></a>

## 多路由共享

复用同一个插件实例，让路由使用同一个容器。按照 Elysia 的显式依赖模式，每个路由模块自行安装插件并声明所需入口。

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

分别调用 `elysiaCyrene()` 会创建独立容器，应分别用于不同应用；同一个应用的路由请复用实例，避免同名 decorator 冲突。

<a id="lifecycle"></a>

## 生命周期

默认 `singleton` 在容器内共享，包含并发请求发起的异步初始化。
`transient` 每次读取属性都会新建实例，**不是每个请求一个实例**；其资源仍由容器统一持有并在关闭时释放。

插件的 `onStop` 钩子会调用 `cyrene.dispose()`，释放实现了 `Symbol.dispose` 或 `Symbol.asyncDispose` 的资源。清理顺序、借用资源和初始化等待沿用 Cyrene 的规则。

Elysia 适配器是否等待异步停止钩子取决于其实现。需要保证资源清理完成并捕获清理错误时，显式等待容器：

```ts
try {
  await app.stop();
} finally {
  await container.decorator.cyrene.dispose();
}
```

只使用 `app.handle()` / `app.fetch()`、没有启动监听服务器时，在应用自己的关闭流程中直接 `await container.decorator.cyrene.dispose()`。清理是幂等的；清理后不能继续解析服务。业务方法中仍在运行的任务由应用先行停止。

<a id="agent"></a>

## Agent

包内提供 [cyrenex-elysia skill](./skills/cyrenex-elysia/SKILL.md)，包含插件注册、共享容器、请求测试和资源清理案例。
使用 `skills-npm` 时可运行 `npx skills-npm` 同步已安装包的 skill；首次配置见 [核心包 Agent 说明](../cyrenex/README.md#agent)。

<a id="development"></a>

## 开发

在仓库根目录运行。先构建各包，生成类型检查所需的声明文件：

```bash
vp install
vp run -r build
vp check
vp test run
```
