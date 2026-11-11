import type * as ts from 'typescript'

/** Kind of a declared symbol. */
export type SymbolKind =
  'class' | 'enum' | 'function' | 'interface' | 'parameter' | 'type' | 'typeParameter' | 'variable'

/**
 * A named declaration tracked by the analyzer.
 */
export class Symbol {
  private readonly _references: ts.Identifier[] = []

  /**
   * @param name Name of the declared symbol.
   * @param kind Kind of declaration.
   * @param declaration Node that declares the symbol, or `undefined` for builtins.
   * @param blockScoped Whether the declaration is limited to its block, like `let` or `class`.
   */
  public constructor(
    public readonly name: string,
    public readonly kind: SymbolKind,
    public readonly declaration: ts.Declaration | undefined,
    public readonly blockScoped: boolean,
  ) {}

  /** References resolved to this symbol, in source order. */
  public get references(): readonly ts.Identifier[] {
    return this._references
  }

  /** Whether the symbol has at least one resolved reference. */
  public get used(): boolean {
    return this._references.length > 0
  }

  /**
   * Records a reference resolved to this symbol.
   *
   * @param reference Identifier that resolved to the symbol.
   */
  public addReference(reference: ts.Identifier): void {
    this._references.push(reference)
  }
}
