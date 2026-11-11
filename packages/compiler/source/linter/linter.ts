import * as ts from 'typescript'

import { type DiagnosticBag } from '../shared/diagnostics/bag.js'
import type { Diagnostic } from '../shared/diagnostics/diagnostic.js'

import { defaultRules } from './rules/index.js'
import type { ReportOptions, Rule, RuleContext, RuleVisitor } from './rules/rule.js'

/** Options that configure a linter. */
export interface LinterOptions {
  /** Rules to run over each syntax tree. Defaults to the built-in rules. */
  readonly rules?: readonly Rule[]
}

/**
 * Runs configurable rules over a syntax tree and collects their findings as diagnostics.
 */
export class Linter {
  private readonly _rules: readonly Rule[]

  /**
   * @param options Linter options. The defaults run the built-in rules.
   */
  public constructor(options: LinterOptions = {}) {
    this._rules = options.rules ?? defaultRules
  }

  /**
   * Lints the given syntax tree. The tree should have parent nodes linked, as produced by the
   * parser.
   *
   * @param sourceFile Syntax tree to analyze.
   * @param diagnostics Bag that collects the findings reported by the rules.
   */
  public lint(sourceFile: ts.SourceFile, diagnostics: DiagnosticBag): void {
    const visitors = new Map<string, RuleVisitor[]>()

    for (const rule of this._rules) {
      collectRuleVisitors(rule, sourceFile, diagnostics, visitors)
    }

    visitNode(sourceFile, visitors)
  }
}

/**
 * Registers the visitors of a rule and reports its findings into the given bag.
 */
function collectRuleVisitors(
  rule: Rule,
  sourceFile: ts.SourceFile,
  diagnostics: DiagnosticBag,
  visitors: Map<string, RuleVisitor[]>,
): void {
  const context: RuleContext = {
    sourceFile,
    report: (node, message, options = {}) => {
      diagnostics.add(createDiagnostic(rule.code, message, sourceFile, node, options))
    },
  }
  const created = rule.create(context)

  for (const [key, visitor] of Object.entries(created)) {
    const existing = visitors.get(key) ?? []
    existing.push(visitor)
    visitors.set(key, existing)
  }
}

/**
 * Converts a rule finding into a diagnostic attached to the given node.
 */
function createDiagnostic(
  code: string,
  message: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  options: ReportOptions,
): Diagnostic {
  const start = options.start ?? node.getStart(sourceFile)
  const end = options.end ?? node.getEnd()
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start)

  return {
    code,
    message,
    severity: options.severity ?? 'error',
    range: { start, end, line, column: character },
  }
}

/**
 * Visits a node and its children, calling the visitors registered for each syntax kind.
 */
function visitNode(node: ts.Node, visitors: ReadonlyMap<string, readonly RuleVisitor[]>): void {
  for (const visitor of visitors.get(String(node.kind)) ?? []) {
    visitor(node)
  }

  ts.forEachChild(node, (child) => {
    visitNode(child, visitors)
  })
}
