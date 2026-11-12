import { type DiagnosticBag } from '../shared/diagnostics/bag.js'
import { computeLineStarts, getPositionAt } from '../shared/position.js'

import { Scanner } from './scanner.js'
import type { Token } from './token.js'

/** Options that configure a lexer. */
export interface LexerOptions {
  /** Whether whitespace and comments are skipped. Defaults to `true`. */
  readonly skipTrivia?: boolean
}

/**
 * Turns Shift source text into tokens using the native scanner.
 */
export class Lexer {
  private readonly _skipTrivia: boolean

  /**
   * @param options Lexer options. The defaults skip whitespace and comments.
   */
  public constructor(options: LexerOptions = {}) {
    this._skipTrivia = options.skipTrivia ?? true
  }

  /**
   * Scans the given source text up to the end of the file.
   *
   * @param source Shift source text.
   * @param diagnostics Bag that collects scan errors, such as unterminated literals.
   * @returns Tokens in source order, excluding the end-of-file token.
   */
  public lex(source: string, diagnostics: DiagnosticBag): Token[] {
    const lineStarts = computeLineStarts(source)
    const scanner = new Scanner(
      source,
      (code, message, start, end) => {
        const { line, character } = getPositionAt(start, lineStarts)

        diagnostics.add({
          code,
          message,
          severity: 'error',
          range: { start, end, line, column: character },
        })
      },
      { skipTrivia: this._skipTrivia },
    )

    const tokens: Token[] = []

    for (let token = scanner.scan(); token.kind !== 'endOfFile'; token = scanner.scan()) {
      const { line, character } = getPositionAt(token.start, lineStarts)

      tokens.push({ ...token, line, column: character })
    }

    return tokens
  }
}
