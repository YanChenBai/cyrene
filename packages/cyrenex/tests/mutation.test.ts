import { describe, expect, it } from 'vite-plus/test';

import { Cyrene, ripple } from '../src/index.ts';

describe('dynamic registration and override', () => {
  it('adds entries after resolution', () => {
    const app = new Cyrene().use(ripple('a', () => 1));

    expect(app.ripples.a).toBe(1);

    const next = app.use(ripple('b', () => 2));
    const scope = app.scope();

    expect(next.ripples.b).toBe(2);
    expect('b' in scope.ripples).toBe(true);
    expect(() => app.use(ripple('a', () => 3))).toThrow('Duplicate Ripple key: a');
  });

  it('retires the target and its dependents across scopes', async () => {
    const events: string[] = [];

    const tracked = <T extends object>(name: string, value: T) => ({
      ...value,
      [Symbol.dispose]: () => events.push(name),
    });

    const Config = ripple('config', () => tracked('config', { env: 'prod' }));

    const Service = ripple('service', { config: Config }, ({ config }) =>
      tracked('service', { env: config.env }),
    );

    const Request = ripple('request', { service: Service }, () => tracked('request', {}), {
      lifetime: 'scoped',
    });

    const Other = ripple('other', () => tracked('other', {}));
    const app = new Cyrene().use(Request, Other);
    const scope = app.scope();

    const before = scope.ripples.request;
    expect(app.resolve(Service).env).toBe('prod');
    app.resolve(Other);

    app.override(
      Config,
      ripple('test-config', () => tracked('test', { env: 'test' })),
    );
    await new Promise(resolve => setTimeout(resolve));

    expect(events).toEqual(['request', 'service', 'config']);
    expect(app.resolve(Service).env).toBe('test');
    expect(scope.ripples.request).not.toBe(before);

    app.override(Config, Config);
    expect(app.resolve(Service).env).toBe('prod');
  });

  it('disposes instances that finish after being overridden', async () => {
    const events: string[] = [];

    const Slow = ripple('slow', async () => ({
      [Symbol.dispose]: () => {
        events.push('old');
      },
    }));

    const app = new Cyrene().use(Slow);
    const pending = app.ripples.slow;

    app.override(
      Slow,
      ripple('fast', async () => ({ [Symbol.dispose]: () => {} })),
    );
    await pending;
    await app.dispose();

    expect(events).toEqual(['old']);
  });

  it('applies overrides registered before use', () => {
    const Value = ripple('value', () => 1);

    const app = new Cyrene()
      .override(
        Value,
        ripple('mock', () => 2),
      )
      .use(Value);

    expect(app.ripples.value).toBe(2);
  });
});
