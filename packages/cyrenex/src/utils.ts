export function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

export function isPromise(value: unknown): value is PromiseLike<unknown> {
  return isObject(value) && typeof Reflect.get(value, 'then') === 'function';
}

export function isDisposable(value: unknown): value is object {
  return isObject(value) && (Symbol.asyncDispose in value || Symbol.dispose in value);
}

export function noop(): void {}

/** 等待全部任务结束；单个失败抛出原错误，多个失败抛出 AggregateError。 */
export async function settle(tasks: Iterable<PromiseLike<unknown>>): Promise<void> {
  const results = await Promise.allSettled(tasks);
  const errors = results.flatMap(result => (result.status === 'rejected' ? [result.reason] : []));

  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length) {
    throw new AggregateError(errors, 'Multiple tasks failed');
  }
}
