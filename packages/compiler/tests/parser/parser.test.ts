import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { Parser } from '../../source/parser/parser.js'
import { DiagnosticBag } from '../../source/shared/diagnostics/bag.js'

function parse(source: string): { file: ts.SourceFile; diagnostics: DiagnosticBag } {
  const diagnostics = new DiagnosticBag()
  const file = new Parser().parse(source, diagnostics)

  return { file, diagnostics }
}

describe('Parser', () => {
  it('parses a variable statement', () => {
    const file = parse('const answer = 42').file
    const statement = file.statements[0]

    expect(file.statements).toHaveLength(1)
    expect(statement?.kind).toBe(ts.SyntaxKind.VariableStatement)
    expect(statement?.getText()).toBe('const answer = 42')
  })

  it('parses multiple top-level declarations', () => {
    const source = [
      'function add(a: number, b: number): number {',
      '  return a + b',
      '}',
      '',
      'class Counter {}',
    ].join('\n')
    const file = parse(source).file

    expect(file.statements.map((statement) => statement.kind)).toEqual([
      ts.SyntaxKind.FunctionDeclaration,
      ts.SyntaxKind.ClassDeclaration,
    ])
  })

  it('uses the provided file name', () => {
    const file = new Parser({ fileName: 'main.ls' }).parse('let x = 1', new DiagnosticBag())

    expect(file.fileName).toBe('main.ls')
  })

  it('defaults to a Livescript file name', () => {
    expect(parse('').file.fileName).toBe('source.ls')
  })

  it('links parent nodes so the tree can be traversed', () => {
    const file = parse('let x = 1').file

    expect(file.statements[0]?.parent).toBe(file)
  })

  it('reports syntax errors into the diagnostics bag', () => {
    const { diagnostics } = parse('const = 1')

    expect(diagnostics.all.map((diagnostic) => diagnostic.code)).toEqual(['1134', '1134'])
    expect(diagnostics.all[0]?.message).toBe('Variable declaration expected.')
    expect(diagnostics.all[0]?.range).toMatchObject({ start: 6, line: 0, column: 6 })
    expect(diagnostics.hasErrors).toBe(true)
  })

  it('collects no diagnostics for valid source', () => {
    expect(parse('let x = 1').diagnostics.empty).toBe(true)
  })
})
