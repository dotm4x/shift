import * as ts from 'typescript'

import { type DiagnosticBag } from '../shared/diagnostics/bag.js'
import { toDiagnosticSeverity } from '../shared/diagnostics/diagnostic.js'
import { computeLineStarts, getPositionAt } from '../shared/position.js'

import type { Token } from './token.js'

/** Options that configure a lexer. */
export interface LexerOptions {
  /** Language version used by the scanner. Defaults to `ScriptTarget.Latest`. */
  readonly languageVersion?: ts.ScriptTarget
  /** Whether whitespace and comments are skipped. Defaults to `true`. */
  readonly skipTrivia?: boolean
}

/**
 * Turns Livescript source text into tokens using the TypeScript scanner.
 */
export class Lexer {
  private readonly _languageVersion: ts.ScriptTarget
  private readonly _skipTrivia: boolean

  /**
   * @param options Scanner options. The defaults scan the latest language version and skip
   * trivia.
   */
  public constructor(options: LexerOptions = {}) {
    this._languageVersion = options.languageVersion ?? ts.ScriptTarget.Latest
    this._skipTrivia = options.skipTrivia ?? true
  }

  /**
   * Scans the given source text up to the end of the file.
   *
   * @param source Livescript source text.
   * @param diagnostics Bag that collects scan errors, such as unterminated literals.
   * @returns Tokens in source order, excluding the end-of-file token.
   */
  public lex(source: string, diagnostics: DiagnosticBag): Token[] {
    const lineStarts = computeLineStarts(source)
    const scanner = ts.createScanner(
      this._languageVersion,
      this._skipTrivia,
      ts.LanguageVariant.Standard,
      source,
    )

    scanner.setOnError((message, length) => {
      const start = scanner.getTokenStart()
      const { line, character } = getPositionAt(start, lineStarts)

      diagnostics.add({
        code: String(message.code),
        message: message.message,
        severity: toDiagnosticSeverity(message.category),
        range: { start, end: start + length, line, column: character },
      })
    })

    const tokens: Token[] = []

    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
      const start = scanner.getTokenStart()
      const { line, character } = getPositionAt(start, lineStarts)

      tokens.push({
        kind,
        text: scanner.getTokenText(),
        value: scanner.getTokenValue(),
        start,
        end: scanner.getTokenEnd(),
        line,
        column: character,
      })
    }

    return tokens
  }
}
