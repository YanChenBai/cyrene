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
lazy 回调仅返回稳定声明，不做 I/O；它在注册时执行，不是在业务方法调用时执行。

## 作用域：每个请求一份 scoped 服务

scoped 服务在同一作用域内复用，作用域关闭时释放；singleton 在所有作用域间共享。

```ts
import assert from 'node:assert/strict';
import { Cyrene, ripple } from 'cyrenex';

const closed: string[] = [];
const Db = ripple('db', () => ({ query: (sql: string) => sql }));
const Session = ripple(
  'session',
  { db: Db },
  ({ db }) => ({
    run: (sql: string) => db.query(sql),
    [Symbol.dispose]() {
      closed.push('session');
    },
  }),
  { lifetime: 'scoped' },
);
const app = new Cyrene().use(Session);

try {
  const first = app.scope();
  const second = app.scope();
  assert.equal(first.ripples.session, first.ripples.session);
  assert.notEqual(first.ripples.session, second.ripples.session);
  assert.equal(first.resolve(Db), second.resolve(Db));

  await first.dispose();
  assert.deepEqual(closed, ['session']);
} finally {
  await app.dispose();
}

assert.deepEqual(closed, ['session', 'session']);
```

不要让 singleton 依赖 scoped 服务，否则解析时会抛出 `InvalidDependencyError`。

## 替换实现：测试替身与运行时切换

用原声明定位目标。替身可以使用不同 key，但不会因此新增公开入口。`override()` 可以在解析前或解析后调用；解析后调用时，目标及依赖它的服务会被释放，并在下次解析时重建。

```ts
import assert from 'node:assert/strict';
import { Cyrene, ripple } from 'cyrenex';

const Config = ripple('config', () => ({ greeting: 'Hello' }));
const Greeting = ripple('greeting', { config: Config }, ({ config }) => ({
  text: config.greeting,
}));
const app = new Cyrene().use(Greeting);

try {
  const before = app.ripples.greeting;
  assert.equal(before.text, 'Hello');

  app.override(
    Config,
    ripple('testConfig', () => ({ greeting: 'Test' })),
  );
  assert.equal(app.ripples.greeting.text, 'Test');
  assert.notEqual(app.ripples.greeting, before);
  assert.equal('testConfig' in app.ripples, false);

  app.override(Config, Config);
  assert.equal(app.ripples.greeting.text, 'Hello');
} finally {
  await app.dispose();
}
```

如果原服务是异步工厂，替身也应保持异步。每个测试创建独立容器，并在 `finally` 中关闭。

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
带清理协议的 transient 实例归发起解析的作用域，作用域关闭时释放；在根容器上反复解析会一直积累到容器关闭。

## 外部资源：应用自行管理关闭

工厂返回值带 Symbol 清理协议时，容器负责关闭。外部共享资源通过不暴露清理协议的业务接口注入，由应用自行关闭。

```ts
import assert from 'node:assert/strict';
import { Cyrene, ripple } from 'cyrenex';

const closed: string[] = [];
const external = {
  read: () => 42,
  [Symbol.dispose]() {
    closed.push('external');
  },
};
const External = ripple('external', () => ({ read: () => external.read() }));
const Resource = ripple('resource', () => ({
  async [Symbol.asyncDispose]() {
    closed.push('resource');
  },
}));
const app = new Cyrene().use(External, Resource);

try {
  app.resolve(External);
  app.resolve(Resource);
} finally {
  try {
    await app.dispose();
  } finally {
    external[Symbol.dispose]();
  }
}

assert.deepEqual(closed, ['resource', 'external']);
```

普通输入值不会因为传给依赖工厂而被容器接管。工厂抛错前已分配、尚未返回的资源需要由工厂自行清理。
