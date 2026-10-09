import assert from 'node:assert/strict';

import { Cyrene, ripple } from 'cyrenex';

export async function runRegistration(): Promise<void> {
  let released = false;

  const external = {
    name: 'application-owned',
    [Symbol.dispose]() {
      released = true;
    },
  };

  try {
    const Config = ripple('config', () => ({ label: 'configured' }));
    const External = ripple('external', () => ({ name: external.name }));
    const Service = ripple('service', { config: Config, external: External }, deps => deps);
    await using app = new Cyrene();

    app.use(Config, External);
    // 接收返回的容器，保留新增服务入口的类型。
    const registered = app.use(Service);
    const byDeclaration = app.resolve(Service);
    const byKey = app.resolve('service'); // unknown, 原 app 的泛型未改变
    assert.equal(registered.ripples.service, byDeclaration);
    assert.equal(byKey, byDeclaration);
    assert.equal(byDeclaration.external.name, external.name);
    process.stdout.write(
      `分步注册: ${byDeclaration.config.label}, ${byDeclaration.external.name}\n`,
    );
  } finally {
    // 注入不含释放协议的业务接口，由应用自行关闭资源。
    assert.equal(released, false);
    external[Symbol.dispose]();
  }

  assert.equal(released, true);
  process.stdout.write('容器已关闭, 外部资源由应用释放\n');
}
