# Cyrene 运行规则

用于排查边界问题；常规接入优先看 SKILL.md 和 examples.md。

## 声明与注册

- key 是不可变的非空字符串。同一声明重复注册幂等；不同声明使用同一个 key 会报错。
- `use()` 先检查整批入口的 key 冲突，再注册并递归收集依赖。可以在解析之后调用，已有作用域也会看到新入口。
- 普通输入、嵌套对象和普通 Promise 原样传入工厂，不会被当作声明递归展开。
- lazy 回调在注册（`use()` / `override()`）时求值，必须稳定且无副作用，可以返回 Ripple 或 Verse。
- 宿主与能力包必须共享同一个 `cyrenex` 模块实例。其他副本的声明无法注册或解析，放在输入中会被当作普通值。

## 解析

- 工厂和全部强依赖都同步时返回实例，否则返回 Promise。异步单例在初始化期间和完成后都返回同一个 Promise。
- 强依赖环在解析时抛出 `CircularDependencyError`。lazy 不是强依赖，可以打破环；但在工厂中同步调用指向自身的 lazy 句柄也会抛出循环错误。
- 不检测跨 `await` 的等待环。双向依赖至少一侧用 lazy，并且在初始化完成后再访问。
- 工厂失败时抛出 `ResolutionError`，`path` 是从入口到失败服务的完整链路，`cause` 是原错误。失败不缓存，下次解析会重新执行工厂。
- 未知 key、缺失的 Verse 实现、Verse 的实现解析为 Promise，都抛出 `InvalidDependencyError`。

## 生命周期与作用域

- singleton 归根容器；scoped 归当前作用域（根容器也算一个）；transient 不缓存，资源归发起解析的作用域。
- 解析 singleton 时，它的整条依赖链都在根容器中进行。链上出现 scoped（包括经过 transient 或 lazy 句柄）会抛出 `InvalidDependencyError`。
- singleton 消费者只在创建时注入一次 transient 依赖；需要每次调用都拿到新对象时，注入 `lazy(() => Job)`。
- 作用域关闭后，公共解析和其 lazy 句柄都会抛出 `DisposedError`。

## override

- 保留原 key 和公开范围；工厂、依赖和 lifetime 来自替身。可以先 override 再 use；以最后一次为准；`override(x, x)` 恢复原实现。
- 目标已注册时，目标及沿强依赖反向能到达的所有服务都会结束：根容器和各作用域中的旧实例移出缓存，并按依赖者在前的顺序释放；仍在初始化的旧实例完成后立即释放。
- lazy 消费者不会结束，它的句柄下次 `resolve()` 会拿到新实现。
- 旧实例在后台释放，清理错误由 `dispose()` 汇总抛出。业务代码持有的旧引用不会被替换。

## 初始化与关闭

- `init()` 初始化当前已注册的所有 singleton（包括 lazy 目标），复用已缓存的实例，可以重复调用。全部分支结束后报告失败。
- `dispose()` 幂等：立即拒绝新的公共解析 → 关闭子作用域 → 等待进行中的初始化（期间新增的任务也会等待）→ 按完成顺序的逆序释放资源。
- 只登记带 `Symbol.asyncDispose` / `Symbol.dispose` 的实例，前者优先；同一对象只释放一次；清理失败后继续，最后抛出 `AggregateError`。
- 消费者就绪后才激活的 lazy 目标完成得更晚，会比消费者更早释放。清理阶段还需要用的资源应声明为强依赖。
- 工厂抛错前已经分配、但尚未返回的资源由工厂自行清理。

## 诊断

`formatGraph(app.inspect())` 展示依赖图。`roots` 是显式入口；`nodes` 包含已注册的 key、lifetime 和根容器中的状态（`registered` / `initializing` / `ready`）；`edges` 包含强依赖和 lazy 边。`inspect()` 不执行工厂。
