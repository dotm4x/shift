import { describe, expect, it } from 'vitest'

import { Lexer } from '../../source/lexer/lexer.js'
import { DiagnosticBag } from '../../source/shared/diagnostics/bag.js'

function lex(source: string): { tokens: ReturnType<Lexer['lex']>; diagnostics: DiagnosticBag } {
  const diagnostics = new DiagnosticBag()
  const tokens = new Lexer().lex(source, diagnostics)

  return { tokens, diagnostics }
}

describe('Lexer edge cases', () => {
  it('scans division after identifiers and numbers', () => {
    expect(lex('a / b').tokens.map((token) => token.kind)).toEqual([
      'identifier',
      'slashToken',
      'identifier',
    ])
    expect(lex('1 / 2').tokens.map((token) => token.kind)).toEqual([
      'numericLiteral',
      'slashToken',
      'numericLiteral',
    ])
  })

  it('scans nested templates', () => {
    const tokens = lex('`a${ `b${c}d` }e`').tokens

    expect(tokens.map((token) => token.kind)).toEqual([
      'templateHead',
      'templateHead',
      'identifier',
      'templateTail',
      'templateTail',
    ])
    expect(tokens.map((token) => token.text)).toEqual(['`a${', '`b${', 'c', '}d`', '}e`'])
  })

  it('reports invalid radix literals', () => {
    const { diagnostics } = lex('0x')

    expect(diagnostics.all[0]?.code).toBe('no-invalid-number')
  })

  it('treats contextual keywords as identifiers in every position', () => {
    expect(lex('let as = 1').tokens[1]?.kind).toBe('identifier')
    expect(lex('let get = 1').tokens[1]?.kind).toBe('identifier')
    expect(lex('let type = 1').tokens[1]?.kind).toBe('identifier')
  })

  it('scans unicode identifiers', () => {
    expect(lex('let ñandú = 1').tokens[1]?.text).toBe('ñandú')
  })

  it('handles CRLF line endings in positions', () => {
    const second = lex('let a = 1\r\nlet b = 2').tokens[4]

    expect(second).toMatchObject({ text: 'let', line: 1, column: 0 })
  })

  it('handles string line continuations', () => {
    const literal = lex('"a\\\nb"').tokens[0]

    expect(literal?.value).toBe('ab')
  })

  it('handles empty templates and substitutions', () => {
    expect(lex('``').tokens.map((token) => token.kind)).toEqual(['templateTail'])
    expect(lex('`${}`').tokens.map((token) => token.kind)).toEqual(['templateHead', 'templateTail'])
  })
})
