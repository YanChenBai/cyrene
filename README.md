<h1 align="center">Cyrene</h1>

<p align="center">TypeScript 依赖注入库，支持按需初始化、类型推导和资源清理。</p>

<p align="center">简体中文 · <a href="./README.en.md">English</a></p>

<p align="center">
  <a href="#quick-start">快速上手</a> ·
  <a href="./packages/cyrenex/README.md">核心包</a> ·
  <a href="./packages/elysia/README.md">Elysia 集成</a> ·
  <a href="#development">开发</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyrenex"><img src="https://img.shields.io/npm/v/cyrenex?style=flat&labelColor=18212f&color=a78bfa" alt="npm 版本" /></a>
  <img src="https://img.shields.io/badge/module-ESM-a78bfa?style=flat&labelColor=18212f" alt="ESM" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.6.0-5fa777?style=flat&labelColor=18212f" alt="Node.js 22.6.0 及以上" />
</p>

<a id="quick-start"></a>

## 快速上手

需要 Node.js 22.6.0 及以上。

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

`ripple()` 声明服务，`use()` 注册入口，读取 `ripples` 时按需创建实例。
依赖声明、异步初始化与生命周期见 [核心包文档](./packages/cyrenex/README.md)。

## 功能

- 通过服务声明引用依赖，自动推导输入和返回类型。
- 同步服务直接返回实例，异步服务返回 Promise。
- 支持单例、每次解析新建实例、延迟解析和初始化前替换实现。
- 支持依赖图检查及 `Symbol.dispose` / `Symbol.asyncDispose` 资源清理。

## 包与示例

| 目录                                           | 用途             |
| ---------------------------------------------- | ---------------- |
| [cyrenex](./packages/cyrenex/README.md)        | 核心运行时       |
| [@cyrenex/elysia](./packages/elysia/README.md) | Elysia 路由集成  |
| [example](./example/README.md)                 | 可运行的完整示例 |

核心包还提供 [Agent skill](./packages/cyrenex/skills/cyrenex/SKILL.md)。

<a id="development"></a>

## 开发

在仓库根目录运行：

```sh
vp install
vp run -r build
vp check
vp test run
```

实现细节见 [设计文档](./packages/cyrenex/docs/CYRENE_DESIGN.md)，行为边界见 [测试](./packages/cyrenex/tests)。
