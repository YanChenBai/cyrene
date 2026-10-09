import { Cyrene, type Ripple, type EntryDeclarations, type ResolveEntries } from 'cyrenex';
import { Elysia } from 'elysia';

let nextPluginId = 0;

/**
 * 创建包含单个 Cyrene 容器的 Elysia 插件。
 *
 * 各路由复用同一插件实例，停止钩子触发资源释放；需保证清理完成时应显式等待 cyrene.dispose()。
 *
 * @returns 通过 app.decorator.cyrene 暴露容器的插件。
 */
export function elysiaCyrene() {
  const cyrene = new Cyrene();

  return new Elysia({ name: '@cyrenex/elysia', seed: nextPluginId++ })
    .decorate({ cyrene })
    .onStop(() => cyrene.dispose());
}

/**
 * 注册 Ripple 入口，并暴露按需解析的装饰器视图。
 *
 * 先安装 elysiaCyrene()，再在解析服务之前注册入口。异步入口的值保留为 Promise。
 *
 * @param ripples - 需要在插件容器中注册的声明。
 * @returns 暴露带类型 ripples 装饰器的 Elysia 插件函数。
 * @throws {Error} 未安装 elysiaCyrene() 时抛出。
 */
export function useRipples<const TRipples extends readonly Ripple[]>(...ripples: TRipples) {
  return (app: Elysia) => {
    const cyrene = (app.decorator as Record<string, unknown>).cyrene;

    if (!(cyrene instanceof Cyrene)) {
      throw new Error('Register elysiaCyrene() before useRipples()');
    }

    cyrene.use(...ripples);

    type Entries = ResolveEntries<EntryDeclarations<TRipples>>;

    // 避免使用可枚举的入口 getter，防止合并装饰器时触发解析并锁定图。
    const view = new Proxy(Object.freeze({}) as Entries, {
      get(_, key) {
        return Reflect.get(cyrene.ripples, key);
      },
      has(_, key) {
        return key in cyrene.ripples;
      },
    });

    return app.decorate({ ripples: view });
  };
}
