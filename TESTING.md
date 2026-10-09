# 测试维护

测试围绕公开行为和真实回归组织，不按源码函数数量或覆盖率百分比补用例。新增测试前先找已有场景：相同故障应优先扩展原用例；只有不同入口确实存在独立逻辑时，才分别覆盖。

## 运行

从仓库根目录执行：

```sh
vp install
vp run -r build
vp check
vp test run
```

Elysia 测试通过包名读取 `dist`，修改核心或适配器后需要先构建，避免测试旧产物。只调整核心测试时可运行 `vp test run packages/cyrenex/tests`。

## 覆盖边界

| 位置                    | 负责的行为                                                  |
| ----------------------- | ----------------------------------------------------------- |
| `resolution.test.ts`    | 同步 / 异步解析、错误链路与重试、循环依赖、lazy、Verse 契约 |
| `lifetime.test.ts`      | singleton / scoped / transient、作用域、关闭顺序与错误汇总  |
| `mutation.test.ts`      | 动态注册、override 结束旧实例、初始化中被替换的实例         |
| `graph.test.ts`         | `inspect()` 快照、`init()` 与 `formatGraph()`               |
| `packages/elysia/tests` | 路由组合、插件隔离、停止钩子和构建产物导出                  |
| `scripts/*.test.ts`     | 发布内容及命令边界；外部命令使用 mock，不执行真实发布       |

## 避免重复和脆弱断言

- 只通过公开 API 测试，优先断言解析结果、错误、公开快照及资源是否释放，不固定内部节点对象身份。
- 断言等待行为时，要在解除阻塞之前确认尚未完成；需要排空微任务时使用事件循环检查点，不靠固定毫秒数猜测。
- 参数化只覆盖实际不同的路径，例如同步/异步、singleton/scoped/transient；三个入口的 Promise 共享不需要重复发起上百次请求。
- mock 只放在工厂调用、释放协议和外部命令等可观察边界。

当前 Elysia 停止测试直接执行框架收集的 hook，并未启动监听服务器；不要把它表述为真实服务器关闭验证。
