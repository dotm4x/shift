import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { Scope } from '../../source/analyzer/scope.js'
import { Symbol } from '../../source/analyzer/symbol.js'
import { Parser } from '../../source/parser/parser.js'
import { DiagnosticBag } from '../../source/shared/diagnostics/bag.js'

function createSymbol(name: string): Symbol {
  const file = new Parser().parse(`let ${name} = 1`, new DiagnosticBag())
  const statement = file.statements[0]

  if (statement === undefined || !ts.isVariableStatement(statement)) {
    throw new Error('Expected a variable statement.')
  }

  const declaration = statement.declarationList.declarations[0]

  if (declaration === undefined) {
    throw new Error('Expected a variable declaration.')
  }

  return new Symbol(name, 'variable', declaration, true)
}

describe('Scope', () => {
  it('resolves symbols through the scope chain', () => {
    const globalScope = new Scope('global', undefined)
    const blockScope = new Scope('block', globalScope)
    const symbol = createSymbol('value')
    globalScope.add(symbol)

    expect(blockScope.resolve('value')).toBe(symbol)
    expect(globalScope.resolve('missing')).toBeUndefined()
  })

  it('lists symbols in declaration order', () => {
    const scope = new Scope('global', undefined)
    scope.add(createSymbol('first'))
    scope.add(createSymbol('second'))

    expect(scope.symbols.map((symbol) => symbol.name)).toEqual(['first', 'second'])
  })

  it('returns the previous symbol when a name is redeclared', () => {
    const scope = new Scope('global', undefined)
    const first = createSymbol('value')
    const second = createSymbol('value')

    expect(scope.add(first)).toBeUndefined()
    expect(scope.add(second)).toBe(first)
  })
})
