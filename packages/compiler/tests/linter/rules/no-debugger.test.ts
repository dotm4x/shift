import { describe, expect, it } from 'vitest'

import { Linter } from '../../../source/linter/linter.js'
import { noDebugger } from '../../../source/linter/rules/no-debugger.js'
import { Parser } from '../../../source/parser/parser.js'
import { DiagnosticBag } from '../../../source/shared/diagnostics/bag.js'

function analyze(source: string): DiagnosticBag {
  const diagnostics = new DiagnosticBag()
  const sourceFile = new Parser().parse(source, new DiagnosticBag())

  new Linter({ rules: [noDebugger] }).lint(sourceFile, diagnostics)

  return diagnostics
}

describe('noDebugger', () => {
  it('reports debugger statements', () => {
    expect(analyze('debugger').all).toEqual([
      {
        code: 'no-debugger',
        message: 'Unexpected debugger statement.',
        severity: 'error',
        range: { start: 0, end: 8, line: 0, column: 0 },
      },
    ])
  })

  it('reports nothing for clean code', () => {
    expect(analyze('let x = 1').empty).toBe(true)
  })
})
