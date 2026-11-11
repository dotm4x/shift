import { describe, expect, it } from 'vitest'

import { DiagnosticBag } from '../../../source/shared/diagnostics/bag.js'
import type {
  Diagnostic,
  DiagnosticSeverity,
} from '../../../source/shared/diagnostics/diagnostic.js'

function diagnostic(code: string, severity: DiagnosticSeverity): Diagnostic {
  return { code, message: code, severity, range: { start: 0, end: 0, line: 0, column: 0 } }
}

describe('DiagnosticBag', () => {
  it('starts empty', () => {
    const bag = new DiagnosticBag()

    expect(bag.empty).toBe(true)
    expect(bag.hasErrors).toBe(false)
  })

  it('collects diagnostics in report order', () => {
    const bag = new DiagnosticBag()

    bag.add(diagnostic('a', 'warning'))
    bag.add(diagnostic('b', 'error'))

    expect(bag.all.map((item) => item.code)).toEqual(['a', 'b'])
    expect(bag.empty).toBe(false)
    expect(bag.hasErrors).toBe(true)
  })

  it('copies every diagnostic of another bag', () => {
    const source = new DiagnosticBag()
    source.add(diagnostic('a', 'error'))
    const target = new DiagnosticBag()

    target.addAll(source)

    expect(target.all.map((item) => item.code)).toEqual(['a'])
    expect(source.all).toHaveLength(1)
  })

  it('can be cleared', () => {
    const bag = new DiagnosticBag()
    bag.add(diagnostic('a', 'error'))

    bag.clear()

    expect(bag.empty).toBe(true)
  })
})
