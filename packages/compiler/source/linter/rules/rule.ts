import type * as ts from 'typescript'

import type { DiagnosticSeverity } from '../../shared/diagnostics/diagnostic.js'

/** Options that adjust where and how a rule reports a finding. */
export interface ReportOptions {
  /** Severity of the diagnostic. Defaults to `error`. */
  readonly severity?: DiagnosticSeverity
  /** Zero-based offset to report from. Defaults to the start of the node. */
  readonly start?: number
  /** Zero-based offset to report to. Defaults to the end of the node. */
  readonly end?: number
}

/** Context given to a rule while it registers its visitors. */
export interface RuleContext {
  /** Syntax tree being analyzed. */
  readonly sourceFile: ts.SourceFile
  /**
   * Reports a finding attached to the given node or offsets.
   *
   * @param node Node the finding refers to.
   * @param message Human-readable description of the finding.
   * @param options Optional severity and range overrides.
   */
  report(node: ts.Node, message: string, options?: ReportOptions): void
}

/** Function that visits a single node kind. */
export type RuleVisitor = (node: ts.Node) => void

/** Visitors keyed by the syntax kind they handle. */
export type RuleVisitors = { [kind in ts.SyntaxKind]?: RuleVisitor }

/** A configurable analysis rule. */
export interface Rule {
  /** Unique code used to identify the rule in diagnostics. */
  readonly code: string
  /**
   * Registers the visitors that visit the nodes the rule cares about.
   *
   * @param context Context used to report findings.
   * @returns Visitors keyed by syntax kind.
   */
  create(context: RuleContext): RuleVisitors
}
