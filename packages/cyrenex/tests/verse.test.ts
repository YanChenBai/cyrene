import { expect, expectTypeOf, it, vi } from 'vite-plus/test';

import {
  CircularDependencyError,
  Cyrene,
  InvalidDependencyError,
  isRipple,
  isVerse,
  ripple,
  verse,
  verseAsync,
} from '../src/index.ts';

it('按 key 注入独立契约，入口顺序不影响查找，也能找到内部声明', async () => {
  const config = verse<{ prefix: string }>('config');
  const provider = ripple('config', () => ({ prefix: 'hello' }));
  const consumer = ripple('consumer', { config }, ({ config }) => config.prefix);
  const root = ripple('root', { provider }, deps => deps);
  const app = new Cyrene().use(consumer, root);
  expectTypeOf(app.ripples.consumer).toEqualTypeOf<string>();
  expect(app.ripples.consumer).toBe('hello');
  expect(app.resolve(verse<{ prefix: string }>('config'))).toBe(app.resolve(provider));
  expect(app.inspect().edges).toContainEqual({
    from: 'consumer',
    to: 'config',
    input: 'config',
    kind: 'dependency',
  });
  expect(Object.keys(app.ripples)).toEqual(['consumer', 'root']);
  await app.dispose();
});

it('ripple 接受共享契约，工厂收到已解析的输入', async () => {
  const config = verse<{ value: number }, 'config'>('config');
  const provider = ripple(config, { value: 42 }, deps => ({ value: deps.value }));

  const consumer = ripple(
    'consumer',
    { config: verse<{ value: number }>('config') },
    deps => deps.config,
  );

  const app = new Cyrene().use(provider, consumer);
  expectTypeOf(provider.key).toEqualTypeOf<'config'>();
  expectTypeOf(app.ripples.config).toEqualTypeOf<{ value: number }>();
  expect(app.ripples.consumer).toBe(app.ripples.config);
  await app.dispose();
});

it('verseAsync 接受同步实现，异步契约沿强依赖传播并缓存 Promise', async () => {
  const config = verseAsync<number>('config');
  const provider = ripple('config', () => 42);
  const consumer = ripple('consumer', { config }, deps => deps.config + 1);
  const top = ripple('top', { consumer }, deps => deps.consumer + 1);
  const app = new Cyrene().use(provider, top);
  expectTypeOf(app.resolve(config)).toEqualTypeOf<Promise<number>>();
  expectTypeOf(app.ripples.top).toEqualTypeOf<Promise<number>>();
  expect(app.resolve(config)).toBe(app.resolve(config));
  expect(app.ripples.top).toBe(app.ripples.top);
  expect(app.resolve(provider)).toBe(42);
  await expect(app.ripples.top).resolves.toBe(44);
  await app.dispose();
});

it('异步提供方即使工厂同步也返回 Promise，并捕获同步失败', async () => {
  const contract = verseAsync<number>('value');
  const provider = ripple(contract, () => 42);
  const app = new Cyrene().use(provider);
  expectTypeOf(app.resolve(provider)).toEqualTypeOf<Promise<number>>();
  expect(app.resolve(provider)).toBe(app.resolve(contract));
  await expect(app.resolve(provider)).resolves.toBe(42);
  await app.dispose();

  const failure = new Cyrene().use(
    ripple(contract, () => {
      throw new Error('failed');
    }),
  );

  await expect(failure.resolve(contract)).rejects.toThrow('Failed to resolve');
  await failure.dispose();
});

it('缺失依赖和同步契约不匹配在构图时报告，不执行工厂', async () => {
  const factory = vi.fn(() => 1);

  const missing = new Cyrene().use(
    ripple('consumer', { config: verse<number>('config') }, factory),
  );

  expect(() => missing.inspect()).toThrow('Missing Verse implementation: config');
  expect(factory).not.toHaveBeenCalled();
  const provider = ripple('config', async () => 42);
  const consumer = ripple('consumer', { config: verse<number>('config') }, factory);
  const mismatch = new Cyrene().use(consumer, provider);
  expect(() => mismatch.inspect()).toThrow('Synchronous Verse');
  expect(factory).not.toHaveBeenCalled();
  await missing.dispose();
  await mismatch.dispose();
});

it('构图无法识别的 Promise 工厂也不能穿透同步契约', async () => {
  const factory = vi.fn(() => 1);
  const provider = ripple('config', () => Promise.resolve(42));
  const consumer = ripple('consumer', { config: verse<number>('config') }, factory);
  const app = new Cyrene().use(provider, consumer);
  expect(() => app.resolve(verse<number>('config'))).toThrow('Synchronous Verse');
  expect(() => app.resolve(consumer)).toThrow('Failed to resolve');
  expect(factory).not.toHaveBeenCalled();
  await app.dispose();
});

it('同步契约被绕过时仍等待并清理异步工厂创建的资源', async () => {
  const close = vi.fn();
  const resource = { [Symbol.dispose]: close };
  const contract = verse<typeof resource>('resource');
  const provider = ripple(contract, (() => Promise.resolve(resource)) as never);
  const app = new Cyrene().use(provider);
  expect(() => app.resolve(provider)).toThrow('Synchronous Verse');
  await app.dispose();
  expect(close).toHaveBeenCalledOnce();
});

it('异步契约访问失败的同步实现时缓存拒绝，强依赖失败也保持异步', async () => {
  const factory = vi.fn(() => {
    throw new Error('failed');
  });

  const contract = verseAsync<number>('config');
  const provider = ripple('config', factory);
  const consumer = ripple('consumer', { config: contract }, deps => deps.config);
  const app = new Cyrene().use(provider, consumer);
  const first = app.resolve(contract);
  expect(first).toBe(app.resolve(contract));
  await expect(first).rejects.toThrow('Failed to resolve');
  await expect(app.ripples.consumer).rejects.toThrow('Failed to resolve');
  expect(factory).toHaveBeenCalledOnce();
  await app.dispose();
});

it('同步契约检查强依赖的传递异步性，覆盖可以移除异步实现', async () => {
  const leaf = ripple('leaf', async () => 42);
  const provider = ripple('config', { leaf }, deps => deps.leaf);
  const consumer = ripple('consumer', { config: verse<number>('config') }, deps => deps.config);
  const app = new Cyrene().use(provider, consumer);
  expect(() => app.inspect()).toThrow('Synchronous Verse');
  const replacement = ripple('replacement', () => 2);
  // 运行时覆盖使用类型擦除模拟外部配置；同步契约基于有效实现校验。
  app.override(provider, replacement as never);
  expect(app.ripples.consumer).toBe(2);
  expect(app.inspect().nodes.map(node => node.key)).not.toContain('leaf');
  await app.dispose();
});

it('verse 边参与环校验，重复实现仍按原有规则拒绝', async () => {
  const left = ripple('left', { right: verse<number>('right') }, deps => deps.right);
  const right = ripple('right', { left: verse<number>('left') }, deps => deps.left);
  const app = new Cyrene().use(left, right);
  expect(() => app.inspect()).toThrow(CircularDependencyError);
  expect(() =>
    new Cyrene().use(
      ripple('config', () => 1),
      ripple('config', () => 2),
    ),
  ).toThrow('Duplicate Ripple key');
  await app.dispose();
});

it('覆盖后的实现供 verse 消费，容器之间不共享实例', async () => {
  const config = verse<{ value: number }>('config');
  const original = ripple('config', () => ({ value: 1 }));
  const consumer = ripple('consumer', { config }, deps => deps.config);

  const first = new Cyrene().use(original, consumer).override(
    original,
    ripple('replacement', () => ({ value: 2 })),
  );

  const second = new Cyrene().use(original, consumer);
  expect(first.ripples.consumer).toEqual({ value: 2 });
  expect(first.resolve(config)).toBe(first.ripples.consumer);
  expect(second.ripples.consumer).toEqual({ value: 1 });
  expect(first.ripples.consumer).not.toBe(second.ripples.consumer);
  await first.dispose();
  await second.dispose();
});

it('transient 和 init 使用 verse 关联后的有效依赖图', async () => {
  const contract = verseAsync<{ value: number }>('config');
  const factory = vi.fn(() => ({ value: 42 }));
  const provider = ripple('config', factory, { lifetime: 'transient' });
  const consumer = ripple('consumer', { config: contract }, deps => deps.config);
  const app = new Cyrene().use(provider, consumer);
  await app.init();
  expect(factory).toHaveBeenCalledTimes(1);
  expect(await app.resolve(contract)).not.toBe(await app.resolve(contract));
  expect(await app.ripples.consumer).toEqual({ value: 42 });
  await app.dispose();
});

it('verse 不接受空 key、伪造契约或直接注册', () => {
  const contract = verse<number>('value');
  expect(Object.isFrozen(contract)).toBe(true);
  expect(isVerse(contract)).toBe(true);
  expect(isRipple(contract)).toBe(false);
  expect(isVerse({ ...contract })).toBe(false);
  expect(() => verse('')).toThrow('non-empty string');
  expect(() => verseAsync(42 as never)).toThrow('non-empty string');
  expect(() => ripple({ ...contract }, () => 1)).toThrow(InvalidDependencyError);
  expect(() => new Cyrene().use(contract as never)).toThrow(InvalidDependencyError);
});
