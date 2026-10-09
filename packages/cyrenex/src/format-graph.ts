import type { DependencyGraph } from './types.ts';

/**
 * 将依赖图快照渲染为终端树。
 *
 * 已展开的共享节点标记为 ↗，循环引用标记为 ↻。
 */
export function formatGraph(graph: DependencyGraph): string {
  if (!graph.nodes.length) {
    return '(empty graph)';
  }

  const children = new Map<string, DependencyGraph['edges']>();

  for (const edge of graph.edges) {
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge]);
  }

  const expanded = new Set<string>();
  const blocks: string[][] = [];

  const visit = (
    key: string,
    prefix: string,
    label: string,
    lines: string[],
    path: Set<string>,
  ) => {
    let marker = expanded.has(key) ? '↗ ' : '';

    if (path.has(key)) {
      marker = '↻ ';
    }

    lines.push(`${label}${marker}${sanitize(key)}`);

    if (marker) {
      return;
    }

    expanded.add(key);
    path.add(key);
    const edges = children.get(key) ?? [];

    edges.forEach((edge, index) => {
      const last = index === edges.length - 1;
      const suffix = edge.kind === 'lazy' ? ' [lazy]' : '';
      const before = lines.length;
      visit(edge.to, prefix + (last ? '   ' : '│  '), prefix + (last ? '└─ ' : '├─ '), lines, path);
      lines[before] += suffix;
    });

    path.delete(key);
  };

  for (const key of [...graph.roots, ...graph.nodes.map(node => node.key)]) {
    if (!expanded.has(key)) {
      const lines: string[] = [];
      visit(key, '', '', lines, new Set());
      blocks.push(lines);
    }
  }

  return blocks.map(lines => lines.join('\n')).join('\n\n');
}

/** 移除 key 中的终端转义序列与控制字符。 */
function sanitize(key: string): string {
  /* oxlint-disable no-control-regex */
  return key
    .replace(/\u001B\][\s\S]*?(?:\u0007|\u001B\|$)/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]|\u001B[ -/]*[0-~]/g, '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\p{Cc}/gu, '');
  /* oxlint-enable no-control-regex */
}
