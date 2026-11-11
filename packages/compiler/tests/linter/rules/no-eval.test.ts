import { describe, expect, it } from 'vitest'

import { Linter } from '../../../source/linter/linter.js'
import { noEval } from '../../../source/linter/rules/no-eval.js'
import { Parser } from '../../../source/parser/parser.js'
import { DiagnosticBag } from '../../../source/shared/diagnostics/bag.js'

function analyze(source: string): DiagnosticBag {
  const diagnostics = new DiagnosticBag()
  const sourceFile = new Parser().parse(source, new DiagnosticBag())

  new Linter({ rules: [noEval] }).lint(sourceFile, diagnostics)

  return diagnostics
}

describe('noEval', () => {
  it('reports eval calls', () => {
    expect(analyze('eval("1 + 1")').all).toEqual([
      {
        code: 'no-eval',
        message: 'Unexpected `eval` call.',
        severity: 'error',
        range: { start: 0, end: 13, line: 0, column: 0 },
      },
    ])
  })

  it('reports nothing for other calls', () => {
    expect(analyze('parse("1 + 1")').empty).toBe(true)
  })
})
