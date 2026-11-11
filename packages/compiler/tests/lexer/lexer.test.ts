import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { Lexer } from '../../source/lexer/lexer.js'
import type { Token } from '../../source/lexer/token.js'
import { DiagnosticBag } from '../../source/shared/diagnostics/bag.js'

function lex(source: string): { tokens: Token[]; diagnostics: DiagnosticBag } {
  const diagnostics = new DiagnosticBag()
  const tokens = new Lexer().lex(source, diagnostics)

  return { tokens, diagnostics }
}

describe('Lexer', () => {
  it('scans keywords, identifiers, operators and literals', () => {
    const tokens = lex('let count = 42').tokens

    expect(tokens.map((token) => token.kind)).toEqual([
      ts.SyntaxKind.LetKeyword,
      ts.SyntaxKind.Identifier,
      ts.SyntaxKind.EqualsToken,
      ts.SyntaxKind.NumericLiteral,
    ])
    expect(tokens.map((token) => token.text)).toEqual(['let', 'count', '=', '42'])
  })

  it('exposes the value of literals', () => {
    const literal = lex('const message = "hello"').tokens.at(-1)

    expect(literal?.value).toBe('hello')
  })

  it('skips comments and whitespace by default', () => {
    const tokens = lex('// note\nlet x = 1 /* trailing */').tokens

    expect(tokens.map((token) => token.text)).toEqual(['let', 'x', '=', '1'])
  })

  it('includes trivia when skipTrivia is disabled', () => {
    const tokens = new Lexer({ skipTrivia: false }).lex('let x', new DiagnosticBag())

    expect(tokens.some((token) => token.kind === ts.SyntaxKind.WhitespaceTrivia)).toBe(true)
  })

  it('tracks zero-based offsets, lines and columns', () => {
    const secondLet = lex('let a = 1\nlet b = 2').tokens[4]

    expect(secondLet).toMatchObject({ text: 'let', start: 10, end: 13, line: 1, column: 0 })
  })

  it('returns no tokens for an empty source', () => {
    expect(lex('').tokens).toEqual([])
  })

  it('reports scan errors into the diagnostics bag', () => {
    const { diagnostics } = lex('let s = "abc')

    expect(diagnostics.all).toEqual([
      {
        code: '1002',
        message: 'Unterminated string literal.',
        severity: 'error',
        range: { start: 8, end: 8, line: 0, column: 8 },
      },
    ])
  })

  it('collects no diagnostics for valid source', () => {
    expect(lex('let x = 1').diagnostics.empty).toBe(true)
  })
})
