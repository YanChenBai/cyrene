import { describe, expect, expectTypeOf, it, vi } from 'vite-plus/test';

import {
  CircularDependencyError,
  Cyrene,
  InvalidDependencyError,
  ResolutionError,
  lazy,
  ripple,
  verse,
} from '../src/index.ts';
import type { Ripple } from '../src/index.ts';

describe('resolution', () => {
  it('resolves sync chains synchronously and caches singletons', () => {
    const factory = vi.fn(() => ({ name: 'config' }));
    const Config = ripple('config', factory);

    const Service = ripple('service', { config: Config, label: 'x' }, ({ config, label }) => ({
      text: `${config.name}:${label}`,
    }));

    const app = new Cyrene().use(Service);

    expectTypeOf(app.ripples.service).toEqualTypeOf<{ text: string }>();
    expect(app.ripples.service.text).toBe('config:x');
    expect(app.resolve(Service)).toBe(app.resolve('service'));
    expect(app.resolve(Config)).toBe(app.resolve('config'));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(Object.keys(app.ripples)).toEqual(['service']);
  });

  it('propagates async dependencies as promises', async () => {
    const Database = ripple('database', async () => ({ users: ['a'] }));
    const Users = ripple('users', { database: Database }, ({ database }) => database.users);
    const app = new Cyrene().use(Users);

    expectTypeOf(app.ripples.users).toEqualTypeOf<Promise<string[]>>();
    const first = app.ripples.users;
    expect(first).toBe(app.ripples.users);
    expect(await first).toEqual(['a']);
    expect(app.ripples.users).toBe(first);
  });

  it('reports the full failure path and retries failed singletons', () => {
    let fail = true;

    const C = ripple('c', () => {
      if (fail) {
        throw new Error('boom');
      }

      return 1;
    });

    const B = ripple('b', { c: C }, ({ c }) => c);
    const A = ripple('a', { b: B }, ({ b }) => b);
    const app = new Cyrene().use(A);

    const error = (() => {
      try {
        app.resolve(A);
      } catch (error) {
        return error;
      }
    })();

    expect(error).toBeInstanceOf(ResolutionError);
    expect((error as ResolutionError).path).toEqual(['a', 'b', 'c']);
    fail = false;
    expect(app.ripples.a).toBe(1);
  });

  it('rejects strong cycles and allows lazy cycles', () => {
    const Parent: Ripple<{ child: () => string }, unknown, false, 'parent'> = ripple(
      'parent',
      { child: lazy(() => Child) },
      ({ child }) => ({ child: () => child.resolve() }),
    );

    const Child = ripple('child', { parent: Parent }, () => 'child');
    const app = new Cyrene().use(Parent);

    expect(app.ripples.parent.child()).toBe('child');

    const Eager: Ripple<string, unknown, false, 'eager'> = ripple(
      'eager',
      { loop: lazy(() => Loop) },
      ({ loop }) => loop.resolve(),
    );

    const Loop = ripple('loop', { eager: Eager }, () => 'loop');

    expect(() => new Cyrene().use(Loop).resolve(Loop)).toThrow(CircularDependencyError);
  });

  it('resolves verse contracts by key', () => {
    const Port = verse<number>('port');
    const PortImpl = ripple(Port, () => 3000);
    const Server = ripple('server', { port: Port, later: lazy(() => Port) }, deps => deps);
    const app = new Cyrene().use(Server, PortImpl);

    expect(app.resolve(Port)).toBe(3000);
    expect(app.ripples.server.port).toBe(3000);
    expect(app.ripples.server.later.resolve()).toBe(3000);

    const Bad = ripple('bad', async () => 1);
    const BadPort = verse<number>('bad');
    const broken = new Cyrene().use(Bad);
    expect(() => broken.resolve(BadPort)).toThrow(InvalidDependencyError);
    expect(() => new Cyrene().resolve(Port)).toThrow('Unknown registration key: port');

    // @ts-expect-error Verse 只能是同步契约
    verse<number | Promise<number>>('async');
  });
});
