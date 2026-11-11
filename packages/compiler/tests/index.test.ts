import { describe, expect, it } from 'vitest'

import { Analyzer, Lexer, Linter, Parser } from '../source/index.js'

describe('compiler package', () => {
  it('exposes the analyzer, lexer, linter and parser', () => {
    expect(Analyzer).toBeTypeOf('function')
    expect(Lexer).toBeTypeOf('function')
    expect(Linter).toBeTypeOf('function')
    expect(Parser).toBeTypeOf('function')
  })
})
