import { defineDependency, isDependency } from './dependency.ts';
import { InvalidDependencyError } from './errors.ts';
import { RIPPLE_BRAND } from './symbols.ts';
import type { Dependency, FactoryAsync, ResolveInputs, RippleOptions, Verse } from './types.ts';
import { isFunction } from './utils.ts';
import { isVerse, isVerseAsync } from './verse.ts';

function ripple<T, const K extends string, R extends NoInfer<T>>(
  contract: Verse<T, false, K>,
  factory: (() => R) & (FactoryAsync<R> extends false ? unknown : never),
  options?: RippleOptions,
): Dependency<T, {}, false, K>;
function ripple<T, const K extends string>(
  contract: Verse<T, true, K>,
  factory: () => NoInfer<T> | PromiseLike<NoInfer<T>>,
  options?: RippleOptions,
): Dependency<T, {}, true, K>;
function ripple<
  T,
  const K extends string,
  const D extends Record<PropertyKey, unknown>,
  R extends NoInfer<T>,
>(
  contract: Verse<T, false, K>,
  deps: D & (FactoryAsync<never, D> extends false ? unknown : never),
  factory: ((deps: ResolveInputs<D>) => R) & (FactoryAsync<R> extends false ? unknown : never),
  options?: RippleOptions,
): Dependency<T, D, false, K>;
function ripple<T, const K extends string, const D extends Record<PropertyKey, unknown>>(
  contract: Verse<T, true, K>,
  deps: D,
  factory: (deps: ResolveInputs<D>) => NoInfer<T> | PromiseLike<NoInfer<T>>,
  options?: RippleOptions,
): Dependency<T, D, true, K>;

function ripple<const K extends string, T>(
  key: K,
  factory: () => T,
  options?: RippleOptions,
): Dependency<Awaited<T>, {}, FactoryAsync<T>, K>;
function ripple<const K extends string, const D extends Record<PropertyKey, unknown>, T>(
  key: K,
  deps: D,
  factory: (deps: ResolveInputs<D>) => T,
  options?: RippleOptions,
): Dependency<Awaited<T>, D, FactoryAsync<T, D>, K>;

/** 声明保存 key 与创建规则，不绑定任何容器或实例。 */
function ripple(
  keyOrContract: string | Verse,
  depsOrFactory: Record<PropertyKey, unknown> | (() => unknown),
  factoryOrOptions?: ((deps: never) => unknown) | RippleOptions,
  configuration?: RippleOptions,
): Dependency {
  const contract = isVerse(keyOrContract) ? keyOrContract : undefined;
  const key = contract ? contract.key : keyOrContract;

  if (typeof key !== 'string' || key.length === 0) {
    throw new InvalidDependencyError('Ripple key must be a non-empty string');
  }

  let inputs: Record<PropertyKey, unknown> = {};
  let factory: unknown = depsOrFactory;
  let options = factoryOrOptions as RippleOptions | undefined;

  if (!isFunction(depsOrFactory)) {
    inputs = depsOrFactory;
    factory = factoryOrOptions;
    options = configuration;
  }

  if (!isFunction(factory) || !inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    throw new InvalidDependencyError('ripple requires a factory and optional dependency inputs');
  }

  validateOptions(options ?? {});
  const declaration = Object.freeze({ key, [RIPPLE_BRAND]: Object.freeze({}) });

  defineDependency(declaration, {
    inputs: Object.freeze({ ...inputs }),
    options: Object.freeze({ ...options }),
    ...createInvocation(factory, isFunction(depsOrFactory), contract),
  });

  return declaration;
}

function createInvocation(factory: Function, withoutInputs: boolean, contract?: Verse) {
  let invoke = (values: Record<PropertyKey, unknown>): unknown =>
    Reflect.apply(factory, undefined, [values]);

  if (withoutInputs) {
    invoke = () => Reflect.apply(factory, undefined, []);
  }

  const contractAsync = contract !== undefined && isVerseAsync(contract);

  if (contractAsync) {
    const original = invoke;
    invoke = values => Promise.resolve().then(() => original(values));
  }

  return {
    invoke,
    async: contractAsync || factory.constructor.name === 'AsyncFunction',
    synchronous: contract !== undefined && !contractAsync,
  };
}

function validateOptions(options: RippleOptions): void {
  if (options.lifetime !== undefined && !['singleton', 'transient'].includes(options.lifetime)) {
    throw new InvalidDependencyError('Unknown lifetime');
  }

  if (options.ownership !== undefined && !['owned', 'borrowed'].includes(options.ownership)) {
    throw new InvalidDependencyError('Unknown ownership');
  }

  if ('dispose' in options) {
    throw new InvalidDependencyError('Use Symbol.asyncDispose or Symbol.dispose on the instance');
  }
}

export function isRipple(value: unknown): value is Dependency {
  return isDependency(value);
}

export { ripple };
