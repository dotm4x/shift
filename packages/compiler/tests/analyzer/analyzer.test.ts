import { describe, expect, it } from 'vitest'

import { Analyzer } from '../../source/analyzer/analyzer.js'
import type { Scope } from '../../source/analyzer/scope.js'
import { Parser } from '../../source/parser/parser.js'
import { DiagnosticBag } from '../../source/shared/diagnostics/bag.js'

function analyze(
  source: string,
  globals?: readonly string[],
): { diagnostics: DiagnosticBag; scope: Scope } {
  const diagnostics = new DiagnosticBag()
  const sourceFile = new Parser().parse(source, new DiagnosticBag())
  const analyzer = globals === undefined ? new Analyzer() : new Analyzer({ globals })
  const scope = analyzer.analyze(sourceFile, diagnostics)

  return { diagnostics, scope }
}

describe('Analyzer', () => {
  it('resolves references through function scopes', () => {
    const source = 'function add(first, second) { return first + second }\nadd(1, 2)'

    expect(analyze(source).diagnostics.empty).toBe(true)
  })

  it('resolves outer variables from inner blocks', () => {
    expect(analyze('let value = 1\nif (value) { value }').diagnostics.empty).toBe(true)
  })

  it('reports undeclared references', () => {
    const { diagnostics } = analyze('let total = 0\ntotal = missing + 1')

    expect(diagnostics.all).toEqual([
      {
        code: 'no-undeclared-reference',
        message: "Identifier 'missing' is not declared.",
        severity: 'error',
        range: { start: 22, end: 29, line: 1, column: 8 },
      },
    ])
  })

  it('reports undeclared references inside functions', () => {
    const { diagnostics } = analyze('function f() { return missing }')

    expect(diagnostics.all.map((diagnostic) => diagnostic.code)).toEqual([
      'no-undeclared-reference',
      'no-unused-variable',
    ])
  })

  it('reports duplicate declarations', () => {
    const { diagnostics } = analyze('let x = 1\nlet x = 2\nx')

    expect(diagnostics.all).toEqual([
      {
        code: 'no-duplicate-declaration',
        message: "Identifier 'x' is already declared.",
        severity: 'error',
        range: { start: 14, end: 19, line: 1, column: 4 },
      },
    ])
  })

  it('allows redeclaring with var', () => {
    expect(analyze('var x = 1\nvar x = 2\nx').diagnostics.empty).toBe(true)
  })

  it('reports mixed var and let declarations', () => {
    const { diagnostics } = analyze('var x = 1\nlet x = 2\nx')

    expect(diagnostics.all.map((diagnostic) => diagnostic.code)).toEqual([
      'no-duplicate-declaration',
    ])
  })

  it('reports unused variables', () => {
    const { diagnostics } = analyze('let unused = 1')

    expect(diagnostics.all).toEqual([
      {
        code: 'no-unused-variable',
        message: "Identifier 'unused' is declared but never used.",
        severity: 'warning',
        range: { start: 4, end: 14, line: 0, column: 4 },
      },
    ])
  })

  it('reports nothing when every symbol is used', () => {
    expect(analyze('let used = 1\nused').diagnostics.empty).toBe(true)
  })

  it('honors configured globals', () => {
    expect(analyze('console.log("hi")', ['console']).diagnostics.empty).toBe(true)
  })

  it('reports undeclared globals by default', () => {
    const { diagnostics } = analyze('console.log("hi")')

    expect(diagnostics.all.map((diagnostic) => diagnostic.code)).toEqual([
      'no-undeclared-reference',
    ])
  })

  it('resolves type references to declared types', () => {
    expect(analyze('type Point = { x: number }\nlet p: Point\np').diagnostics.empty).toBe(true)
  })

  it('reports undeclared types', () => {
    const { diagnostics } = analyze('let p: Missing\np')

    expect(diagnostics.all.map((diagnostic) => [diagnostic.code, diagnostic.severity])).toEqual([
      ['no-undeclared-type', 'error'],
    ])
  })

  it('reports unused types', () => {
    const { diagnostics } = analyze('type Point = { x: number }')

    expect(diagnostics.all.map((diagnostic) => [diagnostic.code, diagnostic.severity])).toEqual([
      ['no-unused-variable', 'warning'],
    ])
  })

  it('resolves generic type parameters', () => {
    const source = 'type Box<T> = { value: T }\nlet box: Box<number>\nbox'

    expect(analyze(source).diagnostics.empty).toBe(true)
  })

  it('resolves interfaces, enums and classes as types', () => {
    const source = [
      'interface Shape { area(): number }',
      'enum Color { Red }',
      'class Dot { x = 0 }',
      'let shape: Shape',
      'let color: Color',
      'let dot: Dot',
      'shape',
      'color',
      'dot',
    ].join('\n')

    expect(analyze(source).diagnostics.empty).toBe(true)
  })

  it('resolves generic function type parameters', () => {
    const source = 'function first<T>(items: T[]): T { return items[0] }\nfirst([1])'

    expect(analyze(source).diagnostics.empty).toBe(true)
  })

  it('resolves builtin functions', () => {
    expect(analyze('print(1)').diagnostics.empty).toBe(true)
    expect(analyze('print("hi")').diagnostics.empty).toBe(true)
    expect(analyze('print(true)').diagnostics.empty).toBe(true)
  })

  it('does not report unused builtins', () => {
    expect(analyze('let x = 1\nx').diagnostics.empty).toBe(true)
  })

  it('allows disabling builtins', () => {
    const diagnostics = new DiagnosticBag()
    const sourceFile = new Parser().parse('print(1)', new DiagnosticBag())

    new Analyzer({ builtins: [] }).analyze(sourceFile, diagnostics)

    expect(diagnostics.all.map((diagnostic) => diagnostic.code)).toEqual([
      'no-undeclared-reference',
    ])
  })

  it('allows overriding builtins', () => {
    const { diagnostics } = analyze('function print(value: number): void { }')

    expect(diagnostics.all.map((diagnostic) => [diagnostic.code, diagnostic.severity])).toEqual([
      ['no-unused-variable', 'warning'],
    ])
  })

  it('returns the global scope with its symbols', () => {
    const { scope } = analyze('let count = 1\ncount')

    expect(scope.symbols.map((symbol) => symbol.name)).toEqual(['print', 'count'])
    expect(scope.resolve('count')?.used).toBe(true)
  })
})
