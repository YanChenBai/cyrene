import { expect, expectTypeOf, it, vi } from 'vite-plus/test';

import { CircularDependencyError, Cyrene, DisposedError, lazy, ripple } from '../src/index.ts';
import type { Dependency } from '../src/index.ts';
import { deferred } from './helpers.ts';

it('init 初始化内部和 lazy singleton，并复用已解析实例', async () => {
  const internalFactory = vi.fn(() => ({}));
  const lazyFactory = vi.fn(async () => ({}));
  const internal = ripple('internal', internalFactory);
  const later = ripple('later', lazyFactory);
  const root = ripple('root', { internal, later: lazy(() => later) }, deps => deps);
  const app = new Cyrene().use(root);
  const value = app.ripples.root;
  expect(lazyFactory).not.toHaveBeenCalled();
  const initialization = app.init();
  expectTypeOf(initialization).toEqualTypeOf<Promise<void>>();
  expect(app.init()).toBe(initialization);
  await initialization;
  expect(app.init()).toBe(initialization);
  expect(app.ripples.root).toBe(value);
  expect(internalFactory).toHaveBeenCalledOnce();
  expect(lazyFactory).toHaveBeenCalledOnce();
  expect(Object.keys(app.ripples)).toEqual(['root']);
  expect(app.inspect().nodes.every(node => node.state === 'ready')).toBe(true);
  await app.dispose();
});

it('init 不额外创建 transient，但消费者正常注入且遵循替身 lifetime', async () => {
  const factory = vi.fn(() => ({}));
  const unusedFactory = vi.fn(() => ({}));
  const item = ripple('item', factory, { lifetime: 'transient' });
  const original = ripple('original', () => ({}));
  const replacement = ripple('replacement', unusedFactory, { lifetime: 'transient' });
  const root = ripple('root', { item }, deps => deps);
  const app = new Cyrene().use(item, original, root).override(original, replacement);
  await app.init();
  expect(factory).toHaveBeenCalledOnce();
  expect(unusedFactory).not.toHaveBeenCalled();
  expect(app.ripples.item).not.toBe(app.ripples.root.item);
  expect(factory).toHaveBeenCalledTimes(2);
  await app.dispose();
});

it('init 并发启动独立分支，并在强依赖完成后执行消费者', async () => {
  const gate = deferred<void>();
  const events: string[] = [];

  const dependency = ripple('dependency', async () => {
    events.push('dependency');
    await gate.promise;
    events.push('ready');
  });

  const root = ripple('root', { dependency }, () => events.push('root'));

  const independent = ripple('independent', () => {
    events.push('independent');
    gate.resolve();
  });

  const app = new Cyrene().use(root, independent);
  await app.init();
  expect(events).toEqual(['dependency', 'independent', 'ready', 'root']);
  await app.dispose();
});

it('init 在执行工厂前验证整张图，失败后保持锁定并缓存拒绝', async () => {
  const factory = vi.fn(() => 1);
  const first = ripple('same', factory);
  const second = ripple('same', factory);
  const root = ripple('root', { first, second }, deps => deps);
  const app = new Cyrene().use(root);
  const initialization = app.init();
  expect(() => app.use(first)).toThrow('locked');
  expect(() => app.override(first, second)).toThrow('locked');
  await expect(initialization).rejects.toThrow('Duplicate Ripple key');
  expect(app.init()).toBe(initialization);
  expect(factory).not.toHaveBeenCalled();
  await app.dispose();
});

it('init 等待所有分支后聚合同步和异步失败，不自动回滚或重试', async () => {
  const gate = deferred<void>();
  const started = deferred<void>();
  const cleanup = vi.fn();
  const syncFailure = new Error('sync');
  const asyncFailure = new Error('async');

  const brokenFactory = vi.fn(() => {
    throw syncFailure;
  });

  const broken = ripple('broken', brokenFactory);

  const asynchronous = ripple('asynchronous', async () => {
    throw asyncFailure;
  });

  const slow = ripple('slow', async () => {
    started.resolve();
    await gate.promise;

    return { [Symbol.dispose]: cleanup };
  });

  const app = new Cyrene().use(broken, asynchronous, slow);
  const initialization = app.init();
  const settled = vi.fn();
  void initialization.then(settled, settled);

  const assertion = expect(initialization).rejects.toMatchObject({
    errors: [{ cause: syncFailure }, { cause: asyncFailure }],
  });

  await started.promise;
  expect(settled).not.toHaveBeenCalled();
  gate.resolve();
  await assertion;
  expect(app.init()).toBe(initialization);
  expect(brokenFactory).toHaveBeenCalledOnce();
  expect(cleanup).not.toHaveBeenCalled();
  await app.dispose();
  expect(cleanup).toHaveBeenCalledOnce();
});

it('init 后立即关闭仍等待整批任务和初始化期间创建的 lazy transient', async () => {
  const gate = deferred<void>();
  const started = deferred<void>();
  const events: string[] = [];

  const child = ripple('child', () => ({ [Symbol.dispose]: () => events.push('child') }), {
    lifetime: 'transient',
  });

  const root = ripple('root', { child: lazy(() => child) }, async ({ child }) => {
    started.resolve();
    await gate.promise;
    child.resolve();

    return { [Symbol.dispose]: () => events.push('root') };
  });

  const app = new Cyrene().use(root);
  const initialization = app.init();
  const closing = app.dispose();
  await expect(app.init()).rejects.toBeInstanceOf(DisposedError);
  await started.promise;
  expect(events).toEqual([]);
  gate.resolve();
  await initialization;
  await closing;
  expect(events).toEqual(['root', 'child']);
  await expect(app.init()).rejects.toBeInstanceOf(DisposedError);
});

it('工厂同步重入 init 复用已登记的 Promise', async () => {
  const app = new Cyrene();
  let nested: Promise<void> | undefined;
  app.use(
    ripple('root', () => {
      nested = app.init();
    }),
  );
  const initialization = app.init();
  await initialization;
  expect(nested).toBe(initialization);
  await app.dispose();
});

it('空容器 init 也锁定配置，未启动的已关闭容器拒绝 init', async () => {
  const app = new Cyrene();
  await app.init();
  expect(() => app.use(ripple('later', () => 1))).toThrow('locked');
  await app.dispose();
  const closed = new Cyrene();
  await closed.dispose();
  await expect(closed.init()).rejects.toBeInstanceOf(DisposedError);
});

it('init 与正在进行的公共解析共享单例，单个失败保留原错误', async () => {
  const gate = deferred<void>();
  const failure = new Error('unavailable');

  const factory = vi.fn(async () => {
    await gate.promise;
    throw failure;
  });

  const service = ripple('service', factory);
  const app = new Cyrene().use(service);
  const pending = app.resolve(service);
  const resolution = expect(pending).rejects.toMatchObject({ cause: failure });
  const initialization = expect(app.init()).rejects.toMatchObject({ cause: failure });
  gate.resolve();
  await Promise.all([resolution, initialization]);
  expect(app.resolve(service)).toBe(pending);
  expect(factory).toHaveBeenCalledOnce();
  await app.dispose();
});

it('init 仍拒绝 lazy 实际等待环，失败后可以关闭', async () => {
  const self: Dependency<unknown> = ripple('self', { self: lazy(() => self) }, async deps => {
    await Promise.resolve();

    return deps.self.resolve();
  });

  const app = new Cyrene().use(self);
  await expect(app.init()).rejects.toBeInstanceOf(CircularDependencyError);
  await app.dispose();
});
