import { describe, expect, it } from 'vite-plus/test';

import { Cyrene, DisposedError, InvalidDependencyError, ripple } from '../src/index.ts';

const resource = (name: string, events: string[]) => ({
  name,
  [Symbol.dispose]: () => events.push(name),
});

describe('lifetimes and scopes', () => {
  it('caches singleton in root, scoped per scope, transient never', async () => {
    let count = 0;
    const Root = ripple('root', () => ++count);

    const Request = ripple('request', { root: Root }, () => ({ id: ++count }), {
      lifetime: 'scoped',
    });

    const Temp = ripple('temp', () => ({}), { lifetime: 'transient' });
    const app = new Cyrene().use(Root, Request, Temp);

    const a = app.scope();
    const b = app.scope();

    expect(a.ripples.root).toBe(b.ripples.root);
    expect(a.ripples.request).toBe(a.ripples.request);
    expect(a.ripples.request).not.toBe(b.ripples.request);
    expect(a.ripples.temp).not.toBe(a.ripples.temp);

    await a.dispose();
    expect(() => a.ripples.request).toThrow(DisposedError);
    expect(b.ripples.root).toBe(1);
  });

  it('rejects scoped dependencies of singletons', () => {
    const Request = ripple('request', () => ({}), { lifetime: 'scoped' });
    const Temp = ripple('temp', { request: Request }, () => ({}), { lifetime: 'transient' });
    const Service = ripple('service', { temp: Temp }, () => ({}));
    const app = new Cyrene().use(Service, Request);

    expect(() => app.scope().resolve(Service)).toThrow(InvalidDependencyError);
    expect(app.scope().resolve(Request)).toBeTypeOf('object');
  });

  it('disposes scope resources before root resources, in reverse order', async () => {
    const events: string[] = [];
    const Db = ripple('db', () => resource('db', events));

    const Repo = ripple('repo', { db: Db }, () => resource('repo', events), {
      lifetime: 'scoped',
    });

    const Temp = ripple('temp', () => resource('temp', events), { lifetime: 'transient' });
    const app = new Cyrene().use(Repo, Temp);
    const scope = app.scope();

    scope.resolve(Repo);
    scope.resolve(Temp);
    app.resolve(Temp);
    await app.dispose();

    expect(events).toEqual(['temp', 'repo', 'temp', 'db']);
    expect(() => app.scope()).toThrow(DisposedError);
  });

  it('waits for pending initialization before disposing', async () => {
    const events: string[] = [];

    const Slow = ripple('slow', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));

      return resource('slow', events);
    });

    const app = new Cyrene().use(Slow);

    void app.ripples.slow;
    await app.dispose();
    expect(events).toEqual(['slow']);
  });

  it('aggregates disposal errors', async () => {
    const Bad = ripple('bad', () => ({
      [Symbol.dispose]() {
        throw new Error('fail');
      },
    }));

    const app = new Cyrene().use(Bad);

    app.resolve(Bad);
    await expect(app.dispose()).rejects.toBeInstanceOf(AggregateError);
  });
});
