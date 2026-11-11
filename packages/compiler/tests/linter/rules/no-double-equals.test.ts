import { describe, expect, it } from 'vitest'

import { Linter } from '../../../source/linter/linter.js'
import { noDoubleEquals } from '../../../source/linter/rules/no-double-equals.js'
import { Parser } from '../../../source/parser/parser.js'
import { DiagnosticBag } from '../../../source/shared/diagnostics/bag.js'

function analyze(source: string): DiagnosticBag {
  const diagnostics = new DiagnosticBag()
  const sourceFile = new Parser().parse(source, new DiagnosticBag())

  new Linter({ rules: [noDoubleEquals] }).lint(sourceFile, diagnostics)

  return diagnostics
}

describe('noDoubleEquals', () => {
  it('reports loose equality comparisons', () => {
    expect(analyze('if (a == b) {}').all).toEqual([
      {
        code: 'no-double-equals',
        message: 'Use `===` instead of `==`.',
        severity: 'error',
        range: { start: 6, end: 8, line: 0, column: 6 },
      },
    ])
  })

  it('reports loose inequality comparisons', () => {
    const diagnostic = analyze('if (a != b) {}').all[0]

    expect(diagnostic?.message).toBe('Use `!==` instead of `!=`.')
  })

  it('reports nothing for strict comparisons', () => {
    expect(analyze('if (a === b) {}').empty).toBe(true)
  })
})
