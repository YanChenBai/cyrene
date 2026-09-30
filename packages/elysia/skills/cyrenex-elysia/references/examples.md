# Elysia 路由与生命周期案例

每个 TypeScript ESM 代码块均独立运行，不依赖数据库或监听端口。

## 多路由共享异步单例

插件只创建一次，各模块显式安装同一实例并声明自己的入口。两个请求并发到达时只初始化一次 Users。

```ts
import assert from 'node:assert/strict';
import { elysiaCyrene, useRipples } from '@cyrenex/elysia';
import { ripple } from 'cyrenex';
import { Elysia } from 'elysia';

let loads = 0;
const Users = ripple('users', async () => {
  loads++;
  return { find: (id: string) => ({ id, name: 'Ada' }) };
});
const container = elysiaCyrene();
const usersRoute = new Elysia()
  .use(container)
  .use(useRipples(Users))
  .get('/users/:id', async ({ ripples, params }) => {
    const users = await ripples.users;
    return users.find(params.id);
  });
const namesRoute = new Elysia()
  .use(container)
  .use(useRipples(Users))
  .get('/names/:id', async ({ ripples, params }) => (await ripples.users).find(params.id).name);
const app = new Elysia().use(container).use(usersRoute).use(namesRoute);

try {
  assert.equal(loads, 0);
  const [user, name] = await Promise.all([
    app.handle(new Request('http://localhost/users/1')),
    app.handle(new Request('http://localhost/names/1')),
  ]);
  assert.equal(user.status, 200);
  assert.equal(name.status, 200);
  assert.deepEqual(await user.json(), { id: '1', name: 'Ada' });
  assert.equal(await name.text(), 'Ada');
  assert.equal(loads, 1);
} finally {
  await container.decorator.cyrene.dispose();
}
```

`params.id` 作为方法参数传入，服务里不保存当前请求。应用级 singleton 不提供请求隔离。

## 请求测试：替换内部依赖

配置只被业务服务依赖，不需要作为路由入口公开。替换发生在第一次请求前；测试结束关闭整个容器。

```ts
import assert from 'node:assert/strict';
import { elysiaCyrene, useRipples } from '@cyrenex/elysia';
import { ripple } from 'cyrenex';
import { Elysia } from 'elysia';

const Config = ripple('config', () => ({ greeting: 'Hello' }));
const Greeting = ripple('greeting', { config: Config }, ({ config }) => ({
  greet: (name: string) => `${config.greeting}, ${name}!`,
}));
const container = elysiaCyrene();
const app = new Elysia()
  .use(container)
  .use(useRipples(Greeting))
  .get('/hello/:name', ({ ripples, params }) => ripples.greeting.greet(params.name));

container.decorator.cyrene.override(
  Config,
  ripple('testConfig', () => ({ greeting: 'Test' })),
);

try {
  assert.equal('config' in app.decorator.ripples, false);
  const response = await app.handle(new Request('http://localhost/hello/Ada'));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'Test, Ada!');
} finally {
  await container.decorator.cyrene.dispose();
}
```

每个测试重新创建插件，不复用已经解析或关闭过的容器。替换异步服务时，替身工厂仍需返回兼容的 Promise。

## 不启动服务器时清理资源

下面的内存资源实现 `Symbol.asyncDispose`，用于展示关闭责任；可以替换成应用实际使用的连接或客户端。

```ts
import assert from 'node:assert/strict';
import { elysiaCyrene, useRipples } from '@cyrenex/elysia';
import { ripple } from 'cyrenex';
import { Elysia } from 'elysia';

let closes = 0;
const Store = ripple('store', async () => ({
  read: () => 'ready',
  async [Symbol.asyncDispose]() {
    closes++;
  },
}));
const container = elysiaCyrene();
const app = new Elysia()
  .use(container)
  .use(useRipples(Store))
  .get('/status', async ({ ripples }) => (await ripples.store).read());

try {
  const response = await app.handle(new Request('http://localhost/status'));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ready');
  assert.equal(closes, 0);
} finally {
  await container.decorator.cyrene.dispose();
}

await container.decorator.cyrene.dispose();
assert.equal(closes, 1);
```

真实监听服务的关闭流程应先停止接收请求并等待业务任务结束，再停止服务器，最后在 finally 中等待容器清理。
适配器停止钩子即使已经触发 dispose，再次等待同一容器也安全。`borrowed` 资源由应用所有者清理，不由插件接管。
