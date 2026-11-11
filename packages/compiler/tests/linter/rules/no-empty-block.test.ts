import { describe, expect, it } from 'vitest'

import { Linter } from '../../../source/linter/linter.js'
import { noEmptyBlock } from '../../../source/linter/rules/no-empty-block.js'
import { Parser } from '../../../source/parser/parser.js'
import { DiagnosticBag } from '../../../source/shared/diagnostics/bag.js'

function analyze(source: string): DiagnosticBag {
  const diagnostics = new DiagnosticBag()
  const sourceFile = new Parser().parse(source, new DiagnosticBag())

  new Linter({ rules: [noEmptyBlock] }).lint(sourceFile, diagnostics)

  return diagnostics
}

describe('noEmptyBlock', () => {
  it('reports empty blocks', () => {
    expect(analyze('if (a) {}').all).toEqual([
      {
        code: 'no-empty-block',
        message: 'Unexpected empty block.',
        severity: 'error',
        range: { start: 7, end: 9, line: 0, column: 7 },
      },
    ])
  })

  it('allows empty function bodies', () => {
    expect(analyze('function f() {}').empty).toBe(true)
  })

  it('allows blocks with statements', () => {
    expect(analyze('if (a) { b }').empty).toBe(true)
  })
})
