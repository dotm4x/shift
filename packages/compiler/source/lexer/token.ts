import type * as ts from 'typescript'

/** A single token produced by the lexer. */
export interface Token {
  /** TypeScript syntax kind that identifies the token. */
  readonly kind: ts.SyntaxKind
  /** Exact source text of the token. */
  readonly text: string
  /** Decoded token value, such as the content of a string literal without its quotes. */
  readonly value: string
  /** Zero-based offset of the first character. */
  readonly start: number
  /** Zero-based offset after the last character. */
  readonly end: number
  /** Zero-based line. */
  readonly line: number
  /** Zero-based column. */
  readonly column: number
}
