declare const rippleBrand: unique symbol;
declare const verseBrand: unique symbol;
declare const lazyBrand: unique symbol;

/**
 * singleton 在根容器缓存；scoped 在每个作用域缓存；transient 每次解析新建。
 */
export type Lifetime = 'singleton' | 'scoped' | 'transient';

export interface RippleOptions {
  lifetime?: Lifetime;
}

/** 服务声明：只公开 key，配方保存在内部。 */
export interface Ripple<
  T = unknown,
  Inputs = unknown,
  Async extends boolean = boolean,
  Key extends string = string,
> {
  readonly key: Key;
  readonly [rippleBrand]: { result: T; inputs: Inputs; async: Async };
}

/** 按 key 引用实现的同步契约。 */
export interface Verse<T = unknown, Key extends string = string> {
  readonly key: Key;
  readonly [verseBrand]: { result: T };
}

export interface LazyRef<T = unknown, Async extends boolean = boolean> {
  readonly [lazyBrand]: { result: T; async: Async };
}

export interface Lazy<T, Async extends boolean = boolean> {
  /** 按目标生命周期解析实例。 */
  resolve(): AsyncResult<T, Async>;
}

export type RippleEntries = Record<string, Ripple>;
export type EntryDeclarations<T extends readonly Ripple[]> = {
  [D in T[number] as D['key']]: D;
};

export type InferInput<T> = T extends Ripple<infer R> | Verse<infer R>
  ? R
  : T extends LazyRef<infer R, infer A>
    ? Lazy<R, A>
    : T;

export type ResolveInputs<T> = {
  [K in keyof T]: InferInput<T[K]>;
};

export type AsyncResult<T, Async extends boolean> = Async extends true ? Promise<T> : T;

export type InferAsync<D> = D extends Ripple<unknown, unknown, infer A> ? A : false;

export type Resolved<D> =
  D extends Ripple<infer T, unknown, infer A>
    ? AsyncResult<T, A>
    : D extends Verse<infer T>
      ? T
      : unknown;

type AsyncMode<T> =
  true extends InferAsync<T>
    ? [T] extends [Ripple<unknown, unknown, true>]
      ? 'async'
      : 'maybe'
    : never;

type InputAsync<D> = { [K in keyof D]: AsyncMode<D[K]> }[keyof D];

type FactoryMode<T> = [T] extends [never]
  ? false
  : unknown extends T
    ? boolean
    : [T] extends [PromiseLike<unknown>]
      ? true
      : [Extract<T, PromiseLike<unknown>>] extends [never]
        ? false
        : boolean;

/** 由工厂返回值和各依赖的异步性推导解析结果是否为 Promise。 */
export type FactoryAsync<T, D = {}> =
  FactoryMode<T> extends true
    ? true
    : D extends unknown
      ? 'async' extends InputAsync<D>
        ? true
        : 'maybe' extends InputAsync<D>
          ? boolean
          : FactoryMode<T>
      : never;

export type ResolveEntries<T extends RippleEntries> = {
  readonly [K in keyof T]: Resolved<T[K]>;
};

export type NodeState = 'registered' | 'initializing' | 'ready';

export interface GraphNode {
  key: string;
  lifetime: Lifetime;
  /** 根容器中的实例状态。 */
  state: NodeState;
}

export interface GraphEdge {
  from: string;
  to: string;
  input: PropertyKey;
  kind: 'dependency' | 'lazy';
}

export interface DependencyGraph {
  roots: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}
