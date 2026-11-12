import { describe, expect, it } from 'vitest'

import { Lexer } from '../../source/lexer/lexer.js'
import { tokenKinds as TokenKind } from '../../source/lexer/token.js'
import { DiagnosticBag } from '../../source/shared/diagnostics/bag.js'

function lex(source: string): { tokens: ReturnType<Lexer['lex']>; diagnostics: DiagnosticBag } {
  const diagnostics = new DiagnosticBag()
  const tokens = new Lexer().lex(source, diagnostics)

  return { tokens, diagnostics }
}

function kinds(source: string): string[] {
  return lex(source).tokens.map((token) => token.kind)
}

describe('Lexer', () => {
  it('scans keywords, identifiers, operators and literals', () => {
    const tokens = lex('let count = 42').tokens

    expect(tokens.map((token) => token.kind)).toEqual([
      TokenKind.letKeyword,
      TokenKind.identifier,
      TokenKind.equalsToken,
      TokenKind.numericLiteral,
    ])
    expect(tokens.map((token) => token.text)).toEqual(['let', 'count', '=', '42'])
  })

  it('exposes the value of literals', () => {
    const literal = lex('const message = "hello"').tokens.at(-1)

    expect(literal?.value).toBe('hello')
  })

  it('classifies reserved words as keywords and contextual words as identifiers', () => {
    expect(kinds('let class function return')).toEqual([
      TokenKind.letKeyword,
      TokenKind.classKeyword,
      TokenKind.functionKeyword,
      TokenKind.returnKeyword,
    ])
    expect(kinds('as get set of type satisfies')).toEqual([
      TokenKind.identifier,
      TokenKind.identifier,
      TokenKind.identifier,
      TokenKind.identifier,
      TokenKind.identifier,
      TokenKind.identifier,
    ])
  })

  it('scans every operator and punctuator', () => {
    const source =
      '{ } ( ) [ ] ; , . ... ?. ? => @ < > <= >= == === != !== = += -= *= /= %= **= <<= >>= &= |= ^= &&= ||= ??= && || ! ?? ++ -- + - * / % ** ~ & | ^'
    const tokens = lex(source).tokens

    expect(tokens).toHaveLength(53)
    expect(tokens.every((token) => token.text.trim() !== '')).toBe(true)
    expect(tokens.find((token) => token.text === '===')?.kind).toBe(
      TokenKind.equalsEqualsEqualsToken,
    )
    expect(tokens.find((token) => token.text === '...')?.kind).toBe(TokenKind.dotDotDotToken)
    expect(tokens.find((token) => token.text === '?.')?.kind).toBe(TokenKind.questionDotToken)
    expect(tokens.find((token) => token.text === '=>')?.kind).toBe(TokenKind.arrowToken)
  })

  it('scans numeric literals with radix prefixes, exponents and bigint suffix', () => {
    const tokens = lex('42 3.14 1e3 0xFF 0b1010 0o17 1_000 10n')

    expect(tokens.tokens.map((token) => token.kind)).toEqual(
      new Array(8).fill(TokenKind.numericLiteral),
    )
    expect(tokens.tokens.map((token) => token.text)).toEqual([
      '42',
      '3.14',
      '1e3',
      '0xFF',
      '0b1010',
      '0o17',
      '1_000',
      '10n',
    ])
  })

  it('decodes string escape sequences', () => {
    const literal = lex('"a\\n\\t\\x41\\u00e9\\u{1F600}\\\\\\"b"').tokens[0]

    expect(literal?.value).toBe('a\n\tAé😀\\"b')
  })

  it('decodes single-quoted strings', () => {
    const literal = lex("'it\\'s'").tokens[0]

    expect(literal?.value).toBe("it's")
  })

  it('scans template heads, middles and tails', () => {
    const tokens = lex('`a${x}b${y}c`').tokens

    expect(tokens.map((token) => token.kind)).toEqual([
      TokenKind.templateHead,
      TokenKind.identifier,
      TokenKind.templateMiddle,
      TokenKind.identifier,
      TokenKind.templateTail,
    ])
    expect(tokens.map((token) => token.text)).toEqual(['`a${', 'x', '}b${', 'y', '}c`'])
    expect(tokens[0]?.value).toBe('a')
    expect(tokens[2]?.value).toBe('b')
    expect(tokens[4]?.value).toBe('c')
  })

  it('keeps brace nesting inside template substitutions', () => {
    const tokens = lex('`${ { a: 1 } }`').tokens

    expect(tokens.map((token) => token.kind)).toEqual([
      TokenKind.templateHead,
      TokenKind.openBraceToken,
      TokenKind.identifier,
      TokenKind.colonToken,
      TokenKind.numericLiteral,
      TokenKind.closeBraceToken,
      TokenKind.templateTail,
    ])
  })

  it('skips comments and whitespace by default', () => {
    const tokens = lex('// note\nlet x = 1 /* trailing */').tokens

    expect(tokens.map((token) => token.text)).toEqual(['let', 'x', '=', '1'])
  })

  it('includes trivia when skipTrivia is disabled', () => {
    const tokens = new Lexer({ skipTrivia: false }).lex('let x', new DiagnosticBag())

    expect(tokens.some((token) => token.kind === TokenKind.whitespaceTrivia)).toBe(true)
  })

  it('includes comment tokens when skipTrivia is disabled', () => {
    const tokens = new Lexer({ skipTrivia: false }).lex('/* a */ // b', new DiagnosticBag())

    expect(tokens.map((token) => token.kind)).toEqual([
      TokenKind.multiLineCommentTrivia,
      TokenKind.whitespaceTrivia,
      TokenKind.singleLineCommentTrivia,
    ])
  })

  it('tracks zero-based offsets, lines and columns', () => {
    const secondLet = lex('let a = 1\nlet b = 2').tokens[4]

    expect(secondLet).toMatchObject({ text: 'let', start: 10, end: 13, line: 1, column: 0 })
  })

  it('returns no tokens for an empty source', () => {
    expect(lex('').tokens).toEqual([])
  })

  it('reports unterminated string literals into the diagnostics bag', () => {
    const { diagnostics } = lex('let s = "abc')

    expect(diagnostics.all).toEqual([
      {
        code: 'no-unterminated-string',
        message: 'Unterminated string literal.',
        severity: 'error',
        range: { start: 8, end: 12, line: 0, column: 8 },
      },
    ])
  })

  it('reports unterminated template literals', () => {
    const { diagnostics } = lex('`abc')

    expect(diagnostics.all[0]?.code).toBe('no-unterminated-template')
  })

  it('reports unterminated block comments', () => {
    const { diagnostics } = lex('let a = 1 /* oops')

    expect(diagnostics.all[0]?.code).toBe('no-unterminated-comment')
  })

  it('reports invalid characters without dropping the rest of the input', () => {
    const { tokens, diagnostics } = lex('let a = 1 # 2')

    expect(diagnostics.all[0]?.code).toBe('no-invalid-character')
    expect(tokens.at(-1)?.kind).toBe(TokenKind.numericLiteral)
  })

  it('reports invalid escape sequences', () => {
    const { diagnostics } = lex('"a\\q"')

    expect(diagnostics.all[0]?.code).toBe('no-invalid-escape-sequence')
  })

  it('collects no diagnostics for valid source', () => {
    expect(lex('let x = 1').diagnostics.empty).toBe(true)
  })
})
