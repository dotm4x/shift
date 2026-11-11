import * as ts from 'typescript'

import type { SourceRange } from '../position.js'

/** Severity of a diagnostic. */
export type DiagnosticSeverity = 'error' | 'warning' | 'information'

/** A finding reported by a compiler stage or an analysis rule. */
export interface Diagnostic {
  /** Code that identifies the stage or rule that reported the finding. */
  readonly code: string
  /** Human-readable description of the finding. */
  readonly message: string
  /** Severity of the finding. */
  readonly severity: DiagnosticSeverity
  /** Source range the finding refers to. */
  readonly range: SourceRange
}

/**
 * Converts a TypeScript diagnostic category into a diagnostic severity.
 *
 * @param category Category reported by TypeScript.
 * @returns Matching severity.
 */
export function toDiagnosticSeverity(category: ts.DiagnosticCategory): DiagnosticSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return 'error'
    case ts.DiagnosticCategory.Warning:
      return 'warning'
    case ts.DiagnosticCategory.Suggestion:
    case ts.DiagnosticCategory.Message:
      return 'information'
    default:
      return 'information'
  }
}
