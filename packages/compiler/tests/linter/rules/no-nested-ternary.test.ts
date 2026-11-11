import { describe, expect, it } from 'vitest'

import { Linter } from '../../../source/linter/linter.js'
import { noNestedTernary } from '../../../source/linter/rules/no-nested-ternary.js'
import { Parser } from '../../../source/parser/parser.js'
import { DiagnosticBag } from '../../../source/shared/diagnostics/bag.js'

function analyze(source: string): DiagnosticBag {
  const diagnostics = new DiagnosticBag()
  const sourceFile = new Parser().parse(source, new DiagnosticBag())

  new Linter({ rules: [noNestedTernary] }).lint(sourceFile, diagnostics)

  return diagnostics
}

describe('noNestedTernary', () => {
  it('reports nested conditional expressions', () => {
    expect(analyze('const x = a ? b : c ? d : e').all).toEqual([
      {
        code: 'no-nested-ternary',
        message: 'Avoid nesting conditional expressions.',
        severity: 'error',
        range: { start: 10, end: 27, line: 0, column: 10 },
      },
    ])
  })

  it('reports nothing for simple conditional expressions', () => {
    expect(analyze('const x = a ? b : c').empty).toBe(true)
  })
})
