import { assertDependency, getDefinition } from './dependency.ts';
import {
  CircularDependencyError,
  DisposedError,
  InvalidDependencyError,
  ResolutionError,
} from './errors.ts';
import { compileRegistry } from './registry.ts';
import type { Registry } from './registry.ts';
import { ResourceStore } from './resources.ts';
import type {
  Dependency,
  DependencyEntries,
  DependencyGraph,
  DependencyAsync,
  Resolved,
  ResolveEntries,
  InferInput,
  NodeState,
  EntryDeclarations,
  Verse,
} from './types.ts';
import { inputEntries } from './utils.ts';
import { isVerse, isVerseAsync } from './verse.ts';

interface Resolution {
  key: string;
  parent?: Resolution;
  state: Exclude<NodeState, 'registered'>;
  value?: unknown;
  error?: unknown;
  executing: boolean;
  synchronous: boolean;
  resultDeferred?: boolean;
  asyncValue?: Promise<unknown>;
  /** 仅保存尚未完成的初始化等待边，不维护第二份资源依赖图。 */
  waiting: Set<Resolution>;
}

/** 等待所有分支结束后报告失败，确保 dispose 不遗漏晚到的资源。 */
async function settle<T>(tasks: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(tasks);

  const errors = results
    .filter(result => result.status === 'rejected')
    .map(result => result.reason);

  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length) {
    throw new AggregateError(errors, 'Multiple dependencies failed');
  }

  return results.map(result => (result as PromiseFulfilledResult<T>).value);
}

export class Cyrene<TRipples extends DependencyEntries = {}> {
  #roots = new Map<string, Dependency>();

  #overrides = new Map<Dependency, Dependency>();

  #identities = new Map<Dependency, string>();

  #registry: Registry | undefined;

  #cache = new Map<string, Resolution>();

  #states = new Map<string, NodeState>();

  #executing = new Set<string>();

  #pending = new Set<Promise<unknown>>();

  #resources = new ResourceStore();

  #state: 'configuring' | 'active' | 'disposing' | 'disposed' = 'configuring';

  #disposal: Promise<void> | undefined;

  #initialization: Promise<void> | undefined;

  #ripples: Record<string, unknown> = Object.create(null);

  #view = new Proxy(this.#ripples, {
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
    setPrototypeOf: () => false,
    preventExtensions: () => false,
  });

  get ripples(): ResolveEntries<TRipples> {
    return this.#view as ResolveEntries<TRipples>;
  }

  /** 显式入口原地累积；依赖在构图时自动收集，不暴露为属性。 */
  use<const T extends readonly Dependency[]>(
    ...declarations: T
  ): Cyrene<TRipples & EntryDeclarations<T>>;
  use(...declarations: Dependency[]): unknown {
    this.#assertConfiguring();
    const incoming = new Map<string, Dependency>();

    for (const declaration of declarations) {
      assertDependency(declaration);
      const existing = incoming.get(declaration.key) ?? this.#roots.get(declaration.key);

      if (existing && existing !== declaration) {
        throw new InvalidDependencyError(`Duplicate Ripple key: ${declaration.key}`);
      }

      incoming.set(declaration.key, declaration);
    }

    for (const [key, declaration] of incoming) {
      if (this.#roots.has(key)) {
        continue;
      }

      this.#roots.set(key, declaration);
      Object.defineProperty(this.#ripples, key, {
        enumerable: true,
        get: () => this.resolve(declaration),
      });
      this.#registry = undefined;
    }

    return this;
  }

  /** 替换以原声明定位，保留原 key 与公开范围；构图时检查目标可达性。 */
  override<D extends Dependency>(
    target: D,
    replacement: Dependency<NoInfer<InferInput<D>>, unknown, NoInfer<DependencyAsync<D>>>,
  ): this {
    this.#assertConfiguring();
    assertDependency(target);
    assertDependency(replacement);
    this.#overrides.set(target, replacement);
    this.#registry = undefined;

    return this;
  }

  resolve<D extends Dependency | Verse>(target: D): Resolved<D>;
  resolve<K extends string>(key: K): K extends keyof TRipples ? Resolved<TRipples[K]> : unknown;

  /** 三种入口遵循同一 lifetime；singleton 复用结果，transient 每次重新创建。 */
  resolve(target: string | Dependency | Verse): unknown {
    if (this.#state === 'disposing' || this.#state === 'disposed') {
      throw new DisposedError('Cyrene is disposing or disposed');
    }

    this.#state = 'active';
    Object.preventExtensions(this.#ripples);
    this.#compile();
    const key = this.#resolveKey(target);
    this.#require(key);

    if (isVerse(target)) {
      if (isVerseAsync(target)) {
        const record = this.#resolveRecord(key);

        if (!record.asyncValue) {
          try {
            record.asyncValue = Promise.resolve(this.#result(record));
          } catch (error) {
            record.asyncValue = Promise.reject(error);
          }

          void record.asyncValue.catch(() => {});
        }

        return record.asyncValue;
      }

      const value = this.#resolve(key);
      this.#assertSynchronous(value, key);

      return value;
    }

    return this.#resolve(key);
  }

  /** 主动初始化所有可达 singleton；transient 仍只在实际消费时创建。 */
  init(): Promise<void> {
    if (this.#state === 'disposing' || this.#state === 'disposed') {
      return Promise.reject(new DisposedError('Cyrene is disposing or disposed'));
    }

    if (this.#initialization) {
      return this.#initialization;
    }

    this.#state = 'active';
    Object.preventExtensions(this.#ripples);

    // 先登记整批任务，再执行构图和用户工厂，关闭时才能等待尚未启动的分支。
    const initialization = Promise.resolve().then(async () => {
      const registry = this.#compile();
      const tasks: Promise<unknown>[] = [];

      for (const [key, registration] of registry) {
        if (getDefinition(registration.implementation).options.lifetime === 'transient') {
          continue;
        }

        tasks.push(Promise.resolve().then(() => this.#resolve(key)));
      }

      await settle(tasks);
    });

    this.#initialization = initialization;
    this.#pending.add(initialization);
    void initialization.then(
      () => this.#pending.delete(initialization),
      () => this.#pending.delete(initialization),
    );

    return initialization;
  }

  inspect(): DependencyGraph {
    const registry = this.#compile();

    return {
      roots: [...this.#roots.keys()],
      nodes: [...registry.keys()].map(key => ({
        key,
        state: this.#states.get(key) ?? 'registered',
      })),
      edges: [...registry.values()].flatMap(node =>
        [...node.dependencies.values()].map(edge => ({ ...edge })),
      ),
    };
  }

  /** 关闭入口后等待已接收的初始化，再逆序清理；业务方法的在途工作由应用停止。 */
  dispose(): Promise<void> {
    if (this.#disposal) {
      return this.#disposal;
    }

    this.#state = 'disposing';
    // 先保存关闭 Promise，再执行用户清理代码，保证同步重入 dispose 仍然幂等。
    this.#disposal = Promise.resolve().then(() => this.#close());

    return this.#disposal;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  #assertConfiguring(): void {
    if (this.#state !== 'configuring') {
      throw new InvalidDependencyError('Registrations are locked after the first resolution');
    }
  }

  #compile(): Registry {
    if (!this.#registry) {
      const compiled = compileRegistry(this.#roots.values(), this.#overrides);
      this.#registry = compiled.registry;
      this.#identities = compiled.identities;
    }

    return this.#registry;
  }

  #require(key: string): void {
    if (!this.#registry!.has(key)) {
      throw new InvalidDependencyError(`Unknown registration key: ${key}`);
    }
  }

  /** 字符串和 verse 按 key 定位；Ripple 按有效图中登记的声明身份定位。 */
  #resolveKey(target: string | Dependency | Verse): string {
    if (typeof target === 'string' || isVerse(target)) {
      return typeof target === 'string' ? target : target.key;
    }

    assertDependency(target);

    const key = this.#identities.get(target);

    if (key !== undefined) {
      return key;
    }

    throw new InvalidDependencyError('Unregistered Ripple declaration');
  }

  #resolve(key: string, owner?: Resolution): unknown {
    return this.#result(this.#resolveRecord(key, owner), owner);
  }

  /** singleton 复用缓存，transient 保留独立的初始化记录与等待关系。 */
  #resolveRecord(key: string, owner?: Resolution, deferred = false): Resolution {
    let record = this.#cache.get(key);
    const fresh = !record;

    if (!record) {
      record = this.#newRecord(key, owner);
    }

    if (!fresh && record.executing && (!owner || deferred)) {
      throw new CircularDependencyError(`Circular initialization: ${owner?.key ?? key} -> ${key}`);
    }

    if (!deferred && owner) {
      this.#waitFor(record, owner);
    }

    if (fresh) {
      this.#create(record);
    }

    return record;
  }

  /** 创建初始化记录并保存同步契约；仅 singleton 在执行工厂前进入缓存。 */
  #newRecord(key: string, owner?: Resolution): Resolution {
    this.#assertCreationPath(key, owner);
    const definition = getDefinition(this.#registry!.get(key)!.implementation);

    const record: Resolution = {
      key,
      parent: owner,
      state: 'initializing',
      executing: true,
      synchronous: definition.synchronous,
      waiting: new Set(),
    };

    if (definition.options.lifetime !== 'transient') {
      this.#cache.set(key, record);
    }

    return record;
  }

  /** 等待边只连接尚未完成的具体实例，不按声明 key 合并 transient。 */
  #waitFor(target: Resolution, owner: Resolution): void {
    if (owner.state !== 'initializing' || target.state !== 'initializing') {
      return;
    }

    if (this.#reaches(target, owner)) {
      throw new CircularDependencyError(`Circular initialization: ${owner.key} -> ${target.key}`);
    }

    owner.waiting.add(target);
  }

  /** transient 递归会不断产生新记录，须按仍在初始化的创建链阻止无限展开。 */
  #assertCreationPath(key: string, owner?: Resolution): void {
    if (this.#executing.has(key)) {
      throw new CircularDependencyError(`Circular initialization: ${key}`);
    }

    for (let ancestor = owner; ancestor?.state === 'initializing'; ancestor = ancestor.parent) {
      if (ancestor.key === key) {
        throw new CircularDependencyError(`Circular initialization: ${owner?.key} -> ${key}`);
      }
    }
  }

  /** 交付值或缓存的 Promise，执行同步契约检查并维护消费者的等待边。 */
  #result(record: Resolution, owner?: Resolution): unknown {
    // lazy 启动的消费者可以先等待执行中的父工厂，待其交付结果后再继续。
    let value = record.value;

    if (record.executing) {
      record.resultDeferred = true;
      value = Promise.resolve().then(() => this.#result(record));
    }

    if (isPromise(value)) {
      if (record.synchronous) {
        this.#assertSynchronous(value, record.key);
      }

      if (owner) {
        const release = () => {
          owner.waiting.delete(record);
        };

        // 旁路清理同时处理成功和失败，不改变原 Promise 的身份与拒绝结果。
        void Promise.resolve(value).then(release, release);
      }

      return value;
    }

    owner?.waiting.delete(record);

    if (record.state === 'failed') {
      throw record.error;
    }

    return value;
  }

  /** 执行初始化并追踪异步分支；契约违例仍登记已创建资源，再记录失败。 */
  #create(record: Resolution): void {
    this.#states.set(record.key, 'initializing');
    this.#executing.add(record.key);

    try {
      const registration = this.#registry!.get(record.key)!;
      let value = this.#initialize(record);

      if (registration.async) {
        value = Promise.resolve(value);
      }

      if (isPromise(value)) {
        const promise = Promise.resolve(value)
          .then(result => {
            const completed = this.#complete(record, result);

            if (record.synchronous) {
              throw new InvalidDependencyError(
                `Synchronous Verse requires a synchronous implementation: ${record.key}`,
              );
            }

            return completed;
          })
          .catch(cause => {
            throw this.#fail(record, cause);
          });

        record.value = promise;
        this.#pending.add(promise);
        void promise.then(
          () => this.#pending.delete(promise),
          () => this.#pending.delete(promise),
        );
      } else {
        const result = this.#complete(record, value);

        // 同步环无法交付同步实例；已返回的资源仍须登记并在关闭时释放。
        if (record.resultDeferred) {
          throw new CircularDependencyError(`Circular synchronous initialization: ${record.key}`);
        }

        record.value = result;
      }
    } catch (cause) {
      const error = this.#fail(record, cause);

      if (this.#registry!.get(record.key)!.async) {
        const rejected = Promise.reject(error);
        record.value = rejected;
        void rejected.catch(() => {});
      }
    } finally {
      record.executing = false;
      this.#executing.delete(record.key);
    }
  }

  #complete(record: Resolution, value: unknown): unknown {
    const definition = getDefinition(this.#registry!.get(record.key)!.implementation);
    this.#resources.add(value, definition.options.ownership ?? 'owned');
    record.state = 'ready';
    this.#states.set(record.key, 'ready');
    record.waiting.clear();

    return value;
  }

  #fail(record: Resolution, cause: unknown): unknown {
    record.state = 'failed';
    this.#states.set(record.key, 'failed');
    record.waiting.clear();
    record.error =
      cause instanceof CircularDependencyError || cause instanceof ResolutionError
        ? cause
        : new ResolutionError([record.key], cause);

    return record.error;
  }

  #reaches(source: Resolution, target: Resolution, visited = new Set<Resolution>()): boolean {
    if (source === target) {
      return true;
    }

    if (visited.has(source)) {
      return false;
    }

    visited.add(source);

    return [...source.waiting].some(child => this.#reaches(child, target, visited));
  }

  /** 解析全部强依赖并注入 lazy 句柄；等待异步分支结束后调用工厂。 */
  #initialize(record: Resolution): unknown {
    const registration = this.#registry!.get(record.key)!;
    const definition = getDefinition(registration.implementation);
    const resolved: Record<PropertyKey, unknown> = {};
    const pending: Promise<void>[] = [];
    const errors: unknown[] = [];

    for (const [key, input] of inputEntries(definition.inputs)) {
      const edge = registration.dependencies.get(key);

      try {
        if (!edge) {
          Object.defineProperty(resolved, key, { value: input, enumerable: true });
          continue;
        }

        const value =
          edge.kind === 'lazy' ? this.#lazyHandle(edge.to, record) : this.#resolve(edge.to, record);

        if (registration.synchronousInputs.has(key)) {
          this.#assertSynchronous(value, edge.to);
        }

        const assign = (value: unknown) => {
          Object.defineProperty(resolved, key, { value, enumerable: true });
        };

        if (isPromise(value)) {
          pending.push(Promise.resolve(value).then(assign));
        } else {
          assign(value);
        }
      } catch (error) {
        errors.push(error);
      }
    }

    if (pending.length) {
      return settle([...pending, ...errors.map(error => Promise.reject(error))]).then(() =>
        definition.invoke(resolved),
      );
    }

    if (errors.length === 1) {
      throw errors[0];
    }

    if (errors.length) {
      throw new AggregateError(errors, 'Multiple dependencies failed');
    }

    return definition.invoke(resolved);
  }

  /** 拒绝同步边界中的 Promise，同时观察拒绝，已启动分支仍由容器追踪。 */
  #assertSynchronous(value: unknown, key: string): void {
    if (isPromise(value)) {
      // 已启动的异步分支仍由正常初始化流程追踪和清理。
      void Promise.resolve(value).catch(() => {});
      throw new InvalidDependencyError(
        `Synchronous Verse requires a synchronous implementation: ${key}`,
      );
    }
  }

  #lazyHandle(key: string, owner: Resolution) {
    const pending = new WeakMap<Resolution, Promise<unknown>>();

    return Object.freeze({
      resolve: () => {
        const isClosed =
          this.#state === 'disposed' ||
          (this.#state === 'disposing' && owner.state !== 'initializing');

        if (isClosed || owner.state === 'failed') {
          throw new DisposedError('Lazy owner is unavailable');
        }

        const target = this.#resolveRecord(key, owner, true);
        const value = this.#result(target);

        if (owner.state !== 'initializing' || !isPromise(value)) {
          return value;
        }

        // 启动 lazy 不等于等待；只有消费 Promise 时才登记等待关系。
        const existing = pending.get(target);

        if (existing) {
          return existing;
        }

        const promise = new LazyPromise(Promise.resolve(value), () => {
          this.#waitFor(target, owner);
          this.#result(target, owner);
        });

        pending.set(target, promise);

        return promise;
      },
    });
  }

  async #close(): Promise<void> {
    try {
      while (this.#pending.size) {
        await Promise.allSettled(this.#pending);
      }

      // 真实依赖引用不失效，消费者的清理方法仍可使用尚未释放的依赖。
      await this.#resources.dispose();
    } finally {
      this.#state = 'disposed';
      this.#cache.clear();
      this.#states.clear();
      this.#roots.clear();
      this.#overrides.clear();
      this.#identities.clear();
      this.#registry = undefined;
    }
  }
}

/** Promise 子类让 await 也经过 then，派生结果使用原生 Promise。 */
class LazyPromise extends Promise<unknown> {
  #beforeWait: () => void;

  static get [Symbol.species]() {
    return Promise;
  }

  constructor(promise: Promise<unknown>, beforeWait: () => void) {
    super((resolve, reject) => promise.then(resolve, reject));
    this.#beforeWait = beforeWait;
    // 仅启动而未消费的句柄不应额外产生未处理拒绝。
    void super.then(undefined, () => {});
  }

  // 此类本身就是 Promise，需要拦截 await 的同化过程。
  // oxlint-disable-next-line unicorn/no-thenable
  override then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    try {
      this.#beforeWait();
    } catch (error) {
      return Promise.reject(error).then(onfulfilled, onrejected);
    }

    return super.then(onfulfilled, onrejected);
  }
}

function isPromise(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof Reflect.get(value, 'then') === 'function'
  );
}
