<h1 align="center">Cyrene 示例</h1>

<p align="center">可运行的依赖注入示例，不需要数据库或外部服务。</p>

<p align="center">简体中文 · <a href="./README.en.md">English</a></p>

## 快速上手

在仓库根目录运行：

```sh
vp install
vp run --filter @cyrenex/example start
```

命令会先构建核心包，再运行示例。示例使用 `await using`，需要支持该语法的运行时。
最小用法见 [核心包快速上手](../packages/cyrenex/README.md#quick-start)。

## 示例内容

| 文件                                     | 内容                                           |
| ---------------------------------------- | ---------------------------------------------- |
| [basic.ts](./src/basic.ts)               | 同步依赖、单例复用、替换实现、依赖图与资源清理 |
| [async.ts](./src/async.ts)               | 异步初始化、lazy 依赖与并发解析                |
| [registration.ts](./src/registration.ts) | 分步注册、声明解析与 borrowed 资源             |

[src/index.ts](./src/index.ts) 依次运行三个场景，示例中的断言检查实例身份、创建次数与清理责任。
详细 API 与行为说明见 [核心包文档](../packages/cyrenex/README.md)。
