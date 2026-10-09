export class CyreneError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InvalidDependencyError extends CyreneError {}

export class DisposedError extends CyreneError {}

export class CircularDependencyError extends CyreneError {
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(`Circular dependency: ${path.join(' -> ')}`);
    this.path = Object.freeze([...path]);
  }
}

/** 工厂失败；path 为从解析入口到失败声明的完整链路。 */
export class ResolutionError extends CyreneError {
  readonly path: readonly string[];

  constructor(path: readonly string[], cause: unknown) {
    super(`Failed to resolve ${path.join(' -> ')}`, { cause });
    this.path = Object.freeze([...path]);
  }
}
