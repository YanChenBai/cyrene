import { getDefinition, getLazyTarget, isLazy, isRipple, isVerse } from './declarations.ts';
import type { Definition } from './declarations.ts';
import { InvalidDependencyError } from './errors.ts';
import type { GraphEdge, Ripple, Verse } from './types.ts';

export type Input =
  | { kind: 'value'; value: unknown }
  | { kind: GraphEdge['kind']; target: Ripple | Verse };

export interface Node {
  readonly key: string;
  /** 原声明；override 只替换 definition 和 inputs。 */
  readonly declaration: Ripple;
  definition: Definition;
  inputs: Map<PropertyKey, Input>;
  /** override 后递增，旧代的实例视为已结束。 */
  generation: number;
}

/** 容器共享的注册表：key 到节点，以及公开入口。 */
export class Registry {
  readonly nodes = new Map<string, Node>();

  readonly entries = new Set<string>();

  #overrides = new Map<Ripple, Ripple>();

  use(declarations: readonly Ripple[]): void {
    for (const declaration of declarations) {
      getDefinition(declaration);
      const existing = this.nodes.get(declaration.key);

      if (existing && existing.declaration !== declaration) {
        throw new InvalidDependencyError(`Duplicate Ripple key: ${declaration.key}`);
      }
    }

    for (const declaration of declarations) {
      this.#register(declaration);
      this.entries.add(declaration.key);
    }
  }

  /**
   * 设置替身；目标已注册时返回受影响的 key（目标及其所有强依赖者）。
   */
  override(target: Ripple, replacement: Ripple): Set<string> {
    getDefinition(target);
    getDefinition(replacement);

    if (replacement === target) {
      this.#overrides.delete(target);
    } else {
      this.#overrides.set(target, replacement);
    }

    const node = this.nodes.get(target.key);

    if (!node || node.declaration !== target) {
      return new Set();
    }

    this.#bind(node, replacement);
    const affected = this.#dependents(node.key);

    for (const key of affected) {
      this.nodes.get(key)!.generation++;
    }

    return affected;
  }

  get(target: string | Ripple | Verse): Node {
    if (typeof target !== 'string' && !isRipple(target) && !isVerse(target)) {
      throw new InvalidDependencyError('Expected a key, Ripple or Verse');
    }

    const key = typeof target === 'string' ? target : target.key;
    const node = this.nodes.get(key);

    if (!node) {
      throw new InvalidDependencyError(`Unknown registration key: ${key}`);
    }

    if (isRipple(target) && node.declaration !== target) {
      throw new InvalidDependencyError(`Unregistered Ripple declaration: ${key}`);
    }

    return node;
  }

  #register(declaration: Ripple): Node {
    const existing = this.nodes.get(declaration.key);

    if (existing) {
      if (existing.declaration !== declaration) {
        throw new InvalidDependencyError(`Duplicate Ripple key: ${declaration.key}`);
      }

      return existing;
    }

    const node = { key: declaration.key, declaration, generation: 0 } as Node;
    this.nodes.set(node.key, node);
    this.#bind(node, this.#overrides.get(declaration) ?? declaration);

    return node;
  }

  /** 绑定实现，并注册其引用的 Ripple；Verse 在解析时按 key 查找。 */
  #bind(node: Node, implementation: Ripple): void {
    node.definition = getDefinition(implementation);
    node.inputs = new Map();

    for (const key of Reflect.ownKeys(node.definition.inputs)) {
      const value: unknown = node.definition.inputs[key];
      const lazy = isLazy(value);
      const target = lazy ? getLazyTarget(value) : value;

      if (isRipple(target) || isVerse(target)) {
        node.inputs.set(key, { kind: lazy ? 'lazy' : 'dependency', target });
      } else {
        node.inputs.set(key, { kind: 'value', value });
      }
    }

    for (const input of node.inputs.values()) {
      if (input.kind !== 'value' && isRipple(input.target)) {
        this.#register(input.target);
      }
    }
  }

  /** 沿强依赖反向收集，包含起点。 */
  #dependents(key: string): Set<string> {
    const result = new Set([key]);

    for (const current of result) {
      for (const node of this.nodes.values()) {
        for (const input of node.inputs.values()) {
          if (input.kind === 'dependency' && input.target.key === current) {
            result.add(node.key);
          }
        }
      }
    }

    return result;
  }
}
