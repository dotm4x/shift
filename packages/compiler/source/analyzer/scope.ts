import type { Symbol } from './symbol.js'

/** Kind of a lexical scope. */
export type ScopeKind = 'global' | 'function' | 'block'

/**
 * A lexical scope holding the symbols declared inside it.
 */
export class Scope {
  private readonly _symbols: Map<string, Symbol> = new Map<string, Symbol>()

  /**
   * @param kind Kind of scope.
   * @param parent Scope this one is nested in, if any.
   */
  public constructor(
    public readonly kind: ScopeKind,
    public readonly parent: Scope | undefined,
  ) {}

  /** Symbols declared directly in this scope, in declaration order. */
  public get symbols(): readonly Symbol[] {
    return [...this._symbols.values()]
  }

  /**
   * Adds a symbol to the scope.
   *
   * @param symbol Symbol to declare.
   * @returns The symbol previously declared with the same name, if any.
   */
  public add(symbol: Symbol): Symbol | undefined {
    const existing = this._symbols.get(symbol.name)

    if (existing === undefined) {
      this._symbols.set(symbol.name, symbol)
    }

    return existing
  }

  /**
   * Looks up a symbol by name in this scope and its parents.
   *
   * @param name Name of the symbol.
   * @returns The symbol declared with that name, if any.
   */
  public resolve(name: string): Symbol | undefined {
    let symbol = this.lookup(name)
    let parent = this.parent

    while (symbol === undefined && parent !== undefined) {
      symbol = parent.lookup(name)
      parent = parent.parent
    }

    return symbol
  }

  /**
   * Looks up a symbol declared directly in this scope.
   *
   * @param name Name of the symbol.
   * @returns The symbol declared with that name, if any.
   */
  private lookup(name: string): Symbol | undefined {
    return this._symbols.get(name)
  }
}
