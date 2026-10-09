import { expect, it } from 'vite-plus/test';

import { Cyrene, formatGraph, lazy, ripple } from '../src/index.ts';

it('inspects and formats the graph without creating instances', async () => {
  const Config = ripple('config', () => 1);
  const Logger = ripple('logger', { config: Config }, () => 2);
  const App = ripple('app', { config: Config, logger: Logger, later: lazy(() => Logger) }, () => 3);
  const app = new Cyrene().use(App);

  expect(app.inspect().nodes.map(node => node.state)).toEqual([
    'registered',
    'registered',
    'registered',
  ]);
  expect(formatGraph(app.inspect())).toBe(
    ['app', '├─ config', '├─ logger', '│  └─ ↗ config', '└─ ↗ logger [lazy]'].join('\n'),
  );

  await app.init();
  expect(app.inspect().nodes.every(node => node.state === 'ready')).toBe(true);
  expect(formatGraph({ roots: [], nodes: [], edges: [] })).toBe('(empty graph)');
});
