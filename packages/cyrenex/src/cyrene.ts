import { Context } from './context.ts';
import { DisposedError } from './errors.ts';
import { Registry } from './registry.ts';
import type {
  DependencyGraph,
  EntryDeclarations,
  InferAsync,
  InferInput,
  Resolved,
  ResolveEntries,
  Ripple,
  RippleEntries,
  Verse,
} from './types.ts';

/**
 * 解析上下文的公共视图。
 *
 * scoped 实例在作用域内缓存，dispose() 释放作用域拥有的资源。
 */
export class Scope<TRipples extends RippleEntries = {}> {
  readonly #context: Context;

  readonly #ripples: ResolveEntries<TRipples>;

  /** @internal */
  constructor(context: Context) {
    this.#context = context;
    this.#ripples = createView(context);
  }

  /** 公开入口的只读视图，读取属性时按需解析。 */
  get ripples(): ResolveEntries<TRipples> {
    return this.#ripples;
  }

  /**
   * 通过 key、Ripple 或 Verse 解析实例；同步链直接返回值，存在异步依赖时返回 Promise。
   */
  resolve<D extends Ripple | Verse>(target: D): Resolved<D>;
  resolve<K extends string>(key: K): K extends keyof TRipples ? Resolved<TRipples[K]> : unknown;
  resolve(target: string | Ripple | Verse): unknown {
    return this.#context.resolve(target);
  }

  /** 等待进行中的初始化，再按完成逆序释放资源。重复调用返回同一个 Promise。 */
  dispose(): Promise<void> {
    return this.#context.dispose();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }
}

/**
 * 依赖容器，同时是根作用域。
 *
 * 注册和替换可在任意时刻进行；override 会结束目标及其依赖者的现有实例。
 */
export class Cyrene<TRipples extends RippleEntries = {}> extends Scope<TRipples> {
  readonly #context: Context;

  constructor() {
    const context = new Context(new Registry());
    super(context);
    this.#context = context;
  }

  /** 注册公开入口，依赖会被自动收集。 */
  use<const T extends readonly Ripple[]>(
    ...declarations: T
  ): Cyrene<TRipples & EntryDeclarations<T>>;
  use(...declarations: Ripple[]): unknown {
    this.#assertActive();
    this.#context.registry.use(declarations);

    return this;
  }

  /**
   * 替换声明的实现，保留原 key 和入口。
   *
   * 目标及其强依赖者的已有实例会被移出缓存并释放，下次解析时重新创建。
   */
  override<D extends Ripple>(
    target: D,
    replacement: Ripple<NoInfer<InferInput<D>>, unknown, NoInfer<InferAsync<D>>>,
  ): this {
    this.#assertActive();

    if (this.#context.registry.override(target, replacement).size) {
      this.#context.retire();
    }

    return this;
  }

  /** 创建新作用域，共享注册表和 singleton。 */
  scope(): Scope<TRipples> {
    return new Scope(this.#context.createScope());
  }

  /** 初始化当前已注册的全部 singleton。 */
  init(): Promise<void> {
    return this.#context.init();
  }

  /** 生成依赖图快照，不创建实例。 */
  inspect(): DependencyGraph {
    const { nodes, entries } = this.#context.registry;

    return {
      roots: [...entries],
      nodes: [...nodes.values()].map(node => ({
        key: node.key,
        lifetime: node.definition.lifetime,
        state: this.#context.state(node),
      })),
      edges: [...nodes.values()].flatMap(node =>
        [...node.inputs].flatMap(([input, binding]) =>
          binding.kind !== 'value' && nodes.has(binding.target.key)
            ? [{ from: node.key, to: binding.target.key, input, kind: binding.kind }]
            : [],
        ),
      ),
    };
  }

  #assertActive(): void {
    if (!this.#context.active) {
      throw new DisposedError('Cyrene is disposing or disposed');
    }
  }
}

function createView<T>(context: Context): T {
  const { entries } = context.registry;
  const has = (key: string | symbol) => typeof key === 'string' && entries.has(key);

  return new Proxy(Object.create(null), {
    get: (_, key) => (has(key) ? context.resolve(key as string) : undefined),
    has: (_, key) => has(key),
    ownKeys: () => [...entries],
    getOwnPropertyDescriptor: (_, key) =>
      has(key)
        ? { configurable: true, enumerable: true, get: () => context.resolve(key as string) }
        : undefined,
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
    setPrototypeOf: () => false,
  });
}
