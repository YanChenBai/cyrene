import { isVerse, isVerseAsync } from './declarations.ts';
import {
  CircularDependencyError,
  CyreneError,
  DisposedError,
  InvalidDependencyError,
  ResolutionError,
} from './errors.ts';
import type { Node, Registry } from './registry.ts';
import type { NodeState, Ripple, Verse } from './types.ts';
import { isDisposable, isPromise, noop, settle } from './utils.ts';

interface Instance {
  readonly node: Node;
  readonly generation: number;
  state: 'constructing' | NodeState;
  /** 解析返回的值：同步实例本身，或异步初始化的 Promise。 */
  value?: unknown;
  /** 完成后的实例，用于释放资源。 */
  result?: unknown;
}

type Target = string | Ripple | Verse;

/**
 * 一个解析上下文：根容器或作用域。
 *
 * singleton 归根上下文，scoped 和 transient 归发起解析的上下文。
 */
export class Context {
  readonly registry: Registry;

  readonly root: Context;

  #children = new Set<Context>();

  #cache = new Map<Node, Instance>();

  /** 带清理协议的已完成实例，按完成顺序排列。 */
  #owned = new Set<Instance>();

  #pending = new Set<Promise<unknown>>();

  #errors: unknown[] = [];

  #state: 'active' | 'closing' | 'disposed' = 'active';

  #disposal: Promise<void> | undefined;

  constructor(registry: Registry, root?: Context) {
    this.registry = registry;
    this.root = root ?? this;

    if (root) {
      root.#children.add(this);
    }
  }

  get active(): boolean {
    return this.#state === 'active';
  }

  createScope(): Context {
    this.#assertActive();

    return new Context(this.registry, this);
  }

  resolve(target: Target): unknown {
    this.#assertActive();
    const node = this.registry.get(target);

    return contract(target, () => this.#resolve(node, [], false));
  }

  /** 初始化根上下文中的全部 singleton。 */
  init(): Promise<void> {
    if (!this.active) {
      return Promise.reject(new DisposedError('Cyrene is disposing or disposed'));
    }

    const tasks = [...this.registry.nodes.values()]
      .filter(node => node.definition.lifetime === 'singleton')
      .map(node => new Promise(resolve => resolve(this.#resolve(node, [], false))));

    return settle(tasks);
  }

  state(node: Node): NodeState {
    const instance = this.#cache.get(node);

    return instance?.state === 'constructing' ? 'initializing' : (instance?.state ?? 'registered');
  }

  /** 结束旧代实例：移出缓存，并按完成逆序释放资源。 */
  retire(): void {
    for (const context of [...this.#children, this]) {
      for (const [node, instance] of context.#cache) {
        if (instance.generation !== node.generation) {
          context.#cache.delete(node);
        }
      }

      const stale = [...context.#owned].filter(instance => isStale(instance)).reverse();

      for (const instance of stale) {
        context.#owned.delete(instance);
      }

      if (stale.length) {
        context.#track(context.#release(stale.map(instance => instance.result)));
      }
    }
  }

  dispose(): Promise<void> {
    this.#disposal ??= this.#close();

    return this.#disposal;
  }

  async #close(): Promise<void> {
    this.#state = 'closing';

    for (const result of await Promise.allSettled(
      [...this.#children].map(child => child.dispose()),
    )) {
      if (result.status === 'rejected') {
        this.#errors.push(result.reason);
      }
    }

    while (this.#pending.size) {
      await Promise.allSettled(this.#pending);
    }

    const values = [...this.#owned].reverse().map(instance => instance.result);
    this.#owned.clear();
    this.#cache.clear();
    this.#state = 'disposed';
    await this.#release(values);
    this.root.#children.delete(this);

    if (this.#errors.length) {
      throw new AggregateError(this.#errors, 'Failed to dispose Cyrene resources');
    }
  }

  #assertActive(): void {
    if (!this.active) {
      throw new DisposedError('Cyrene is disposing or disposed');
    }
  }

  /**
   * @param path - 从解析入口到当前节点之前的 key 链。
   * @param captive - 是否处于 singleton 的依赖链中，此时不能解析 scoped。
   */
  #resolve(node: Node, path: readonly string[], captive: boolean): unknown {
    const { lifetime } = node.definition;
    const chain = [...path, node.key];

    if (path.includes(node.key)) {
      throw new CircularDependencyError(chain);
    }

    if (lifetime === 'scoped' && captive) {
      throw new InvalidDependencyError(`Singleton cannot depend on scoped: ${chain.join(' -> ')}`);
    }

    const owner = lifetime === 'singleton' ? this.root : this;

    return owner.#instantiate(node, chain, captive || lifetime === 'singleton');
  }

  #instantiate(node: Node, path: readonly string[], captive: boolean): unknown {
    if (this.#state === 'disposed') {
      throw new DisposedError('Cyrene is disposed');
    }

    const cached = this.#cache.get(node);

    if (cached) {
      if (cached.state === 'constructing') {
        throw new CircularDependencyError(path);
      }

      return cached.value;
    }

    const instance: Instance = { node, generation: node.generation, state: 'constructing' };

    if (node.definition.lifetime !== 'transient') {
      this.#cache.set(node, instance);
    }

    const fail = (cause: unknown) => {
      if (this.#cache.get(node) === instance) {
        this.#cache.delete(node);
      }

      return cause instanceof CyreneError ? cause : new ResolutionError(path, cause);
    };

    let value: unknown;

    try {
      const inputs = this.#inputs(node, path, captive);
      const { invoke, synchronous } = node.definition;
      value = isPromise(inputs) ? inputs.then(invoke) : invoke(inputs);

      if (synchronous && isPromise(value)) {
        // 结果仍可能是资源，到达后直接释放。
        this.#track(Promise.resolve(value).then(result => this.#release([result]), noop));
        throw new InvalidDependencyError(
          `Synchronous Verse requires a synchronous implementation: ${node.key}`,
        );
      }
    } catch (cause) {
      throw fail(cause);
    }

    if (!isPromise(value)) {
      instance.value = value;
      this.#complete(instance, value);

      return value;
    }

    const promise = Promise.resolve(value).then(
      result => {
        this.#complete(instance, result);

        return result;
      },
      cause => {
        throw fail(cause);
      },
    );

    instance.state = 'initializing';
    instance.value = promise;
    this.#track(promise);

    return promise;
  }

  #complete(instance: Instance, value: unknown): void {
    instance.state = 'ready';
    instance.result = value;

    if (!isDisposable(value)) {
      return;
    }

    // 初始化期间被 override 结束的实例，完成后立即释放。
    if (isStale(instance)) {
      this.#track(this.#release([value]));
    } else {
      this.#owned.add(instance);
    }
  }

  /** 解析工厂输入；有异步依赖时返回 Promise。普通值原样传递。 */
  #inputs(node: Node, path: readonly string[], captive: boolean) {
    const values: Record<PropertyKey, unknown> = {};
    const pending: Promise<void>[] = [];

    const assign = (key: PropertyKey, value: unknown) => {
      Object.defineProperty(values, key, { value, enumerable: true });
    };

    try {
      for (const [key, input] of node.inputs) {
        if (input.kind === 'value') {
          assign(key, input.value);
          continue;
        }

        if (input.kind === 'lazy') {
          assign(key, this.#lazy(input.target, captive));
          continue;
        }

        const target = this.registry.get(input.target);
        const value = contract(input.target, () => this.#resolve(target, path, captive));

        if (isPromise(value)) {
          pending.push(Promise.resolve(value).then(result => assign(key, result)));
        } else {
          assign(key, value);
        }
      }
    } catch (error) {
      for (const task of pending) {
        task.then(noop, noop);
      }

      throw error;
    }

    return pending.length ? Promise.all(pending).then(() => values) : values;
  }

  #lazy(target: Ripple | Verse, captive: boolean) {
    return Object.freeze({
      resolve: () => {
        if (this.#state === 'disposed') {
          throw new DisposedError('Lazy owner is disposed');
        }

        const node = this.registry.get(target);

        return contract(target, () => this.#resolve(node, [], captive));
      },
    });
  }

  #track(task: Promise<unknown>): void {
    const release = () => this.#pending.delete(task);
    this.#pending.add(task);
    task.then(release, release);
  }

  /** 按给定顺序逐个释放，错误留到 dispose() 汇总。 */
  async #release(values: unknown[]): Promise<void> {
    for (const value of new Set(values)) {
      if (!isDisposable(value)) {
        continue;
      }

      try {
        const method: unknown =
          Reflect.get(value, Symbol.asyncDispose) ?? Reflect.get(value, Symbol.dispose);

        if (typeof method === 'function') {
          await Reflect.apply(method, value, []);
        }
      } catch (error) {
        this.#errors.push(error);
      }
    }
  }
}

function isStale(instance: Instance): boolean {
  return instance.generation !== instance.node.generation;
}

/** 按 Verse 契约转换结果：异步契约统一为 Promise，同步契约拒绝 Promise。 */
function contract(target: Target, resolve: () => unknown): unknown {
  if (!isVerse(target)) {
    return resolve();
  }

  if (isVerseAsync(target)) {
    try {
      return Promise.resolve(resolve());
    } catch (error) {
      return Promise.reject(error);
    }
  }

  const value = resolve();

  if (isPromise(value)) {
    value.then(noop, noop);
    throw new InvalidDependencyError(
      `Synchronous Verse requires a synchronous implementation: ${target.key}`,
    );
  }

  return value;
}
