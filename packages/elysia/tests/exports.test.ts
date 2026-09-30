import { elysiaCyrene, useRipples } from '@cyrenex/elysia';
import { ripple } from 'cyrenex';
import { Elysia } from 'elysia';
import { expect, expectTypeOf, test } from 'vite-plus/test';

// 从包导出消费构建产物，检查声明文件与运行时入口一致。
test('published exports preserve route and dependency types', async () => {
  const Value = ripple('value', async () => 42);

  const app = new Elysia()
    .use(elysiaCyrene())
    .use(useRipples(Value))
    .get('/value/:id', async ({ ripples, params }) => {
      expectTypeOf(ripples.value).toEqualTypeOf<Promise<number>>();
      expectTypeOf(params.id).toEqualTypeOf<string>();

      return { id: params.id, value: await ripples.value };
    });

  const response = await app.handle(new Request('http://localhost/value/one'));
  expect(await response.json()).toEqual({ id: 'one', value: 42 });
  await app.decorator.cyrene.dispose();
});
