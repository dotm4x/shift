import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { toDiagnosticSeverity } from '../../../source/shared/diagnostics/diagnostic.js'

describe('toDiagnosticSeverity', () => {
  it('maps error categories to error severity', () => {
    expect(toDiagnosticSeverity(ts.DiagnosticCategory.Error)).toBe('error')
  })

  it('maps warning categories to warning severity', () => {
    expect(toDiagnosticSeverity(ts.DiagnosticCategory.Warning)).toBe('warning')
  })

  it('maps remaining categories to information severity', () => {
    expect(toDiagnosticSeverity(ts.DiagnosticCategory.Suggestion)).toBe('information')
    expect(toDiagnosticSeverity(ts.DiagnosticCategory.Message)).toBe('information')
  })
})
