# Cyrene 具体案例

根据任务选择案例，不必把所有模式加入同一个服务。每个 TypeScript ESM 代码块都独立导入依赖，并在结束时关闭容器。

## 异步依赖与 lazy：调用方法时才创建服务

`Users` 是异步服务；`Report` 只持有 lazy 句柄，因此 `app.ripples.report` 本身同步。
下面用内存数据模拟异步加载，不需要数据库。

```ts
import assert from 'node:assert/strict';
import { Cyrene, lazy, ripple } from 'cyrenex';

let loads = 0;
const Users = ripple('users', async () => {
  loads++;
  return { list: () => ['Ada'] };
});
const Report = ripple('report', { users: lazy(() => Users) }, ({ users }) => ({
  run: async () => (await users.resolve()).list(),
}));
const app = new Cyrene().use(Report);

try {
  const report = app.ripples.report;
  assert.equal(loads, 0);
  assert.deepEqual(await report.run(), ['Ada']);
  assert.deepEqual(await report.run(), ['Ada']);
  assert.equal(loads, 1);
} finally {
  await app.dispose();
}
```

如果每次创建 `Report` 都必须等待 `Users`，改用强依赖 `{ users: Users }`，工厂直接调用 `users.list()`，调用方则需要 `await app.ripples.report`。
lazy 回调仅返回稳定声明，不做 I/O；它在构图时执行，不是在业务方法调用时执行。

## 测试替身：解析前替换内部依赖

用原声明定位目标。替身可以使用不同 key，但不会因此新增公开入口。
如果原服务是异步工厂，替身也应保留异步契约。

```ts
import assert from 'node:assert/strict';
import { Cyrene, ripple } from 'cyrenex';

const Config = ripple('config', () => ({ greeting: 'Hello' }));
const Greeting = ripple('greeting', { config: Config }, ({ config }) => config.greeting);
const TestConfig = ripple('testConfig', () => ({ greeting: 'Test' }));
const app = new Cyrene().use(Greeting).override(Config, TestConfig);

try {
  assert.equal(app.ripples.greeting, 'Test');
  assert.equal(app.resolve(Config), app.resolve(TestConfig));
  assert.equal('testConfig' in app.ripples, false);
} finally {
  await app.dispose();
}
```

每个测试创建独立容器、在 `finally` 中关闭。不要在读过 `ripples` 后覆盖，也不要为了换实现重新注册同 key 的声明。

## Transient：单例消费者只保留首次注入的对象

适用于收集器、构建器等每次任务需要新实例的对象。将 transient 注入 singleton，不会让它随每次业务方法调用重建。

```ts
import assert from 'node:assert/strict';
import { Cyrene, ripple } from 'cyrenex';

const Job = ripple('job', () => ({ messages: [] as string[] }), { lifetime: 'transient' });
const Worker = ripple('worker', { job: Job }, ({ job }) => ({ job }));
const app = new Cyrene().use(Worker);

try {
  const first = app.resolve(Job);
  const second = app.resolve(Job);
  assert.notEqual(first, second);
  assert.equal(app.ripples.worker.job, app.ripples.worker.job);
} finally {
  await app.dispose();
}
```

需要每次业务调用拿到新对象时，可注入 `lazy(() => Job)` 并在方法中调用句柄的 `resolve()`。
transient 的带清理协议实例会被保留到容器关闭；长期运行的服务不要无限创建此类资源。

## Owned 与 borrowed：明确谁负责清理

本例用内存资源演示清理协议。真实连接应在工厂返回的对象上实现相同的 Symbol 方法。

```ts
import assert from 'node:assert/strict';
import { Cyrene, ripple } from 'cyrenex';

const closed: string[] = [];
const external = {
  [Symbol.dispose]() {
    closed.push('external');
  },
};
const Borrowed = ripple('external', () => external, { ownership: 'borrowed' });
const Resource = ripple('resource', () => ({
  async [Symbol.asyncDispose]() {
    closed.push('owned');
  },
}));
const app = new Cyrene().use(Borrowed, Resource);

try {
  app.resolve(Borrowed);
  app.resolve(Resource);
} finally {
  try {
    await app.dispose();
  } finally {
    external[Symbol.dispose]();
  }
}

assert.deepEqual(closed, ['owned', 'external']);
```

普通输入值不会因为传给依赖工厂而被容器接管。工厂抛错前已分配、尚未返回的资源需要由工厂自行清理。
