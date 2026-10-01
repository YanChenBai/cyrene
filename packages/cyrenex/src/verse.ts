import { InvalidDependencyError } from './errors.ts';
import { VERSE_BRAND } from './symbols.ts';
import type { Verse } from './types.ts';
import { isObject } from './utils.ts';

const contracts = new WeakMap<object, boolean>();

/** 声明按 key 查找的同步契约，不携带实现。 */
export function verse<T, const K extends string = string>(key: K): Verse<T, false, K> {
  return createVerse(key, false);
}

/** 异步契约允许同步实现，但解析结果始终为 Promise。 */
export function verseAsync<T, const K extends string = string>(key: K): Verse<T, true, K> {
  return createVerse(key, true);
}

function createVerse<T, A extends boolean, K extends string>(key: K, async: A): Verse<T, A, K> {
  if (typeof key !== 'string' || key.length === 0) {
    throw new InvalidDependencyError('Verse key must be a non-empty string');
  }

  const reference = Object.freeze({ key, [VERSE_BRAND]: Object.freeze({}) });
  contracts.set(reference, async);

  return reference;
}

export function isVerse(value: unknown): value is Verse {
  return isObject(value) && contracts.has(value);
}

export function isVerseAsync(reference: Verse): boolean {
  return contracts.get(reference) === true;
}
