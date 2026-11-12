import type * as ts from 'typescript'

/**
 * An error reported by a compiler stage, attached to the syntax node that caused it.
 */
export class CompilerError extends Error {
  /**
   * @param code Code that identifies the error.
   * @param message Human-readable description of the error.
   * @param node Node the error refers to, if any.
   * @param hint Suggestion to fix the error, if any.
   */
  public constructor(
    public readonly code: string,
    message: string,
    public readonly node: ts.Node | undefined,
    public readonly hint?: string,
  ) {
    super(message)
    this.name = 'CompilerError'
  }
}
