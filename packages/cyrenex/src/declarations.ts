import { InvalidDependencyError } from './errors.ts';
import type {
  FactoryAsync,
  InferAsync,
  InferInput,
  LazyRef,
  Lifetime,
  ResolveInputs,
  Ripple,
  RippleOptions,
  Verse,
} from './types.ts';
import { isObject } from './utils.ts';

export interface Definition {
  readonly inputs: Readonly<Record<PropertyKey, unknown>>;
  readonly invoke: (inputs: Record<PropertyKey, unknown>) => unknown;
  readonly lifetime: Lifetime;
  /** 由同步 Verse 声明，结果不能是 Promise。 */
  readonly synchronous: boolean;
}

const definitions = new WeakMap<object, Definition>();
const verses = new WeakSet<object>();
const lazies = new WeakMap<object, () => Ripple | Verse>();
const lifetimes: readonly Lifetime[] = ['singleton', 'scoped', 'transient'];

function ripple<T, const K extends string, R extends NoInfer<T>>(
  contract: Verse<T, K>,
  factory: (() => R) & (FactoryAsync<R> extends false ? unknown : never),
  options?: RippleOptions,
): Ripple<T, {}, false, K>;
function ripple<
  T,
  const K extends string,
  const D extends Record<PropertyKey, unknown>,
  R extends NoInfer<T>,
>(
  contract: Verse<T, K>,
  deps: D & (FactoryAsync<never, D> extends false ? unknown : never),
  factory: ((deps: ResolveInputs<D>) => R) & (FactoryAsync<R> extends false ? unknown : never),
  options?: RippleOptions,
): Ripple<T, D, false, K>;
function ripple<const K extends string, T>(
  key: K,
  factory: () => T,
  options?: RippleOptions,
): Ripple<Awaited<T>, {}, FactoryAsync<T>, K>;
function ripple<const K extends string, const D extends Record<PropertyKey, unknown>, T>(
  key: K,
  deps: D,
  factory: (deps: ResolveInputs<D>) => T,
  options?: RippleOptions,
): Ripple<Awaited<T>, D, FactoryAsync<T, D>, K>;

/** 声明服务：key 或 Verse 契约、可选依赖、工厂和生命周期。 */
function ripple(keyOrContract: string | Verse, ...args: [unknown, unknown?, unknown?]): Ripple {
  const key = isVerse(keyOrContract) ? keyOrContract.key : keyOrContract;

  const [inputs, factory, options = {}] = (
    typeof args[0] === 'function' ? [{}, ...args] : args
  ) as [Record<PropertyKey, unknown>, Function, RippleOptions | undefined];

  assertKey(key);

  if (typeof factory !== 'function' || !isObject(inputs) || Array.isArray(inputs)) {
    throw new InvalidDependencyError('ripple requires optional inputs and a factory');
  }

  const lifetime = assertLifetime(options.lifetime);

  const call = (values: Record<PropertyKey, unknown>) =>
    Reflect.apply(factory, undefined, typeof args[0] === 'function' ? [] : [values]);

  const declaration = Object.freeze({ key });

  definitions.set(declaration, {
    inputs: Object.freeze({ ...inputs }),
    invoke: call,
    lifetime,
    synchronous: isVerse(keyOrContract),
  });

  // 类型标记只存在于类型层面。
  return declaration as Ripple;
}

export { ripple };

/** 声明按 key 查找实现的契约：实现必须同步返回，T 不能包含 Promise。 */
export function verse<T, const K extends string = string>(
  key: K &
    ([Extract<T, PromiseLike<unknown>>] extends [never] ? unknown : 'Verse<T> cannot be a Promise'),
): Verse<T, K> {
  assertKey(key);
  const reference = Object.freeze({ key });
  verses.add(reference);

  return reference as Verse<T, K>;
}

/** 延迟依赖：注入带 resolve() 的句柄，回调可引用后定义的声明。 */
export function lazy<D extends Ripple | Verse>(
  getTarget: () => D,
): LazyRef<InferInput<D>, InferAsync<D>> {
  const reference = Object.freeze({});
  lazies.set(reference, getTarget);

  return reference as LazyRef<InferInput<D>, InferAsync<D>>;
}

export function isRipple(value: unknown): value is Ripple {
  return isObject(value) && definitions.has(value);
}

export function isVerse(value: unknown): value is Verse {
  return isObject(value) && verses.has(value);
}

export function isLazy(value: unknown): value is LazyRef {
  return isObject(value) && lazies.has(value);
}

export function getDefinition(value: Ripple): Definition {
  const definition = definitions.get(value);

  if (!definition) {
    throw new InvalidDependencyError('Expected a Ripple declaration');
  }

  return definition;
}

export function getLazyTarget(value: LazyRef): Ripple | Verse {
  const target = lazies.get(value)?.();

  if (!isRipple(target) && !isVerse(target)) {
    throw new InvalidDependencyError('lazy() must return a Ripple or Verse');
  }

  return target;
}

function assertLifetime(lifetime: Lifetime = 'singleton'): Lifetime {
  if (!lifetimes.includes(lifetime)) {
    throw new InvalidDependencyError(`Unknown lifetime: ${String(lifetime)}`);
  }

  return lifetime;
}

function assertKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new InvalidDependencyError('Key must be a non-empty string');
  }
}
