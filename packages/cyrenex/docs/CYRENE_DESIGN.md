# Cyrene 设计

**注册表描述"怎么建"，上下文负责"建出来放哪、什么时候释放"。**

## 模块

| 文件              | 职责                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `declarations.ts` | `ripple` / `verse` / `verseAsync` / `lazy`，配方保存在内部 WeakMap      |
| `registry.ts`     | key → 节点，公开入口，override 时计算受影响的依赖者                     |
| `context.ts`      | 解析、缓存、作用域、资源登记与释放；根容器和作用域都是一个 Context      |
| `cyrene.ts`       | 公共类：`Scope`（`ripples` / `resolve` / `dispose`）和继承它的 `Cyrene` |
| `format-graph.ts` | 把 `inspect()` 快照渲染成终端树                                         |

声明对象只有冻结的 `key`。配方（输入、工厂、lifetime、同步契约）以声明身份为键保存在模块内的 WeakMap 中，所以不同副本的 `cyrenex` 无法互认声明。

## 注册表

```ts
interface Node {
  key: string;
  declaration: Ripple; // 原声明，决定节点身份
  definition: Definition; // 当前实现（可能来自 override）
  inputs: Map<PropertyKey, Input>; // value / dependency / lazy
  generation: number; // override 时递增
}
```

- `use()` 先检查整批入口的 key 冲突，再注册节点并递归注册其中引用的 Ripple。Verse 不注册，解析时按 key 查找。
- lazy 回调在绑定输入时求值，结果可以是 Ripple 或 Verse。
- 不做静态编译和环检测，所以 `use()` 和 `override()` 可以在任何时候调用。缺失实现和强依赖环在解析时报告。
- `override(target, replacement)` 记录替身。如果目标已注册，就重新绑定节点的 definition 和 inputs，沿强依赖反向收集依赖者（包括目标本身），并把它们的 `generation` 加一。

## 上下文与解析

```text
Context(root) ── singleton 缓存、资源
  ├─ Context(scope A) ── scoped 缓存、transient 资源
  └─ Context(scope B)
```

`#resolve(node, path, captive)` 的流程：

1. `path` 中已经有这个 key，说明存在强依赖环，抛出 `CircularDependencyError`。
2. 节点是 scoped 且 `captive` 为真（当前处于 singleton 的依赖链中），抛出 `InvalidDependencyError`。
3. 选择归属：singleton 归根上下文，其他归当前上下文。
4. 命中缓存时直接返回缓存的值或 Promise。如果命中的实例还在同步构造中，抛出循环错误；这种情况只会由 lazy 的同步重入触发。
5. 未命中时，非 transient 先写入缓存，再解析输入：强依赖递归解析（Verse 经过契约转换），lazy 注入句柄，普通值原样传递。存在异步依赖时，等全部完成后再调用工厂。
6. 同步结果直接完成。异步结果把 Promise 存为实例值，并登记到上下文的待完成集合。
7. 失败时移出缓存（不缓存失败），并包装成 `ResolutionError(path, cause)`。已经是 `CyreneError` 的错误原样上抛，所以 `path` 是从入口到最深失败点的完整链路。

实例记录保存 `value`（返回给调用方的值或 Promise）、`result`（完成后的实例）和创建时的 `generation`。完成时，带清理协议的实例按完成顺序加入 `owned`。

## override 与旧实例

`generation` 不一致的实例就是旧实例。`Context.retire()` 先遍历子作用域，再遍历根上下文：

- 把旧实例移出缓存，下次解析时用新实现重建；
- 把 `owned` 中的旧实例按完成顺序的逆序释放，释放任务登记到待完成集合；
- 仍在初始化中的旧实例完成时会检查 `generation`，如果已过期就立即释放，不再登记。

lazy 边不参与依赖者的计算：句柄每次 `resolve()` 都会重新查找，自然会拿到新实现。

## 关闭

`dispose()` 的步骤：

1. 状态设为 `closing`，公共解析立即被拒绝；内部的初始化仍可以继续解析依赖。
2. 关闭全部子作用域。
3. 循环等待待完成集合清空，期间新登记的任务也会被等待。
4. 状态设为 `disposed`，按完成顺序的逆序释放 `owned`，同一对象只释放一次，`Symbol.asyncDispose` 优先。
5. 子作用域的关闭错误、override 后释放旧实例的错误和本次的清理错误一起汇总成 `AggregateError`。

## 取舍

- 依赖链用普通递归解析，极深的同步链受 JavaScript 调用栈限制。
- 不检测跨 `await` 的等待环。双向依赖应该至少有一侧使用 lazy，并且在初始化完成后再访问。
- 作用域只有一层（由根容器创建），不支持嵌套作用域。
- `inspect()` 中节点的 `state` 只反映根上下文的缓存。
