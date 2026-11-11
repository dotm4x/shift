import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { Linter } from '../../source/linter/linter.js'
import type { Rule } from '../../source/linter/rules/rule.js'
import { Parser } from '../../source/parser/parser.js'
import { DiagnosticBag } from '../../source/shared/diagnostics/bag.js'

function analyze(source: string, rules?: readonly Rule[]): DiagnosticBag {
  const diagnostics = new DiagnosticBag()
  const linter = rules === undefined ? new Linter() : new Linter({ rules })
  const sourceFile = new Parser().parse(source, new DiagnosticBag())

  linter.lint(sourceFile, diagnostics)

  return diagnostics
}

describe('Linter', () => {
  it('runs the default rules', () => {
    const diagnostics = analyze('debugger')

    expect(diagnostics.all).toEqual([
      {
        code: 'no-debugger',
        message: 'Unexpected debugger statement.',
        severity: 'error',
        range: { start: 0, end: 8, line: 0, column: 0 },
      },
    ])
  })

  it('reports nothing when no rules are configured', () => {
    expect(analyze('debugger', []).empty).toBe(true)
  })

  it('runs custom rules', () => {
    const noFoo: Rule = {
      code: 'no-foo',
      create(context) {
        return {
          [ts.SyntaxKind.Identifier]: (node) => {
            if (ts.isIdentifier(node) && node.text === 'foo') {
              context.report(node, 'Unexpected `foo` identifier.')
            }
          },
        }
      },
    }
    const diagnostics = analyze('let foo = 1', [noFoo])

    expect(diagnostics.all).toEqual([
      {
        code: 'no-foo',
        message: 'Unexpected `foo` identifier.',
        severity: 'error',
        range: { start: 4, end: 7, line: 0, column: 4 },
      },
    ])
  })

  it('supports custom severities', () => {
    const warnDebugger: Rule = {
      code: 'warn-debugger',
      create(context) {
        return {
          [ts.SyntaxKind.DebuggerStatement]: (node) => {
            context.report(node, 'Debugger found.', { severity: 'warning' })
          },
        }
      },
    }
    const diagnostics = analyze('debugger', [warnDebugger])

    expect(diagnostics.all.map((diagnostic) => diagnostic.severity)).toEqual(['warning'])
    expect(diagnostics.hasErrors).toBe(false)
  })

  it('reports findings in traversal order', () => {
    const diagnostics = analyze('debugger\ndebugger')

    expect(diagnostics.all.map((diagnostic) => diagnostic.range.line)).toEqual([0, 1])
  })
})
