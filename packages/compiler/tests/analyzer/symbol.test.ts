import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

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

function firstIdentifierOf(source: string): ts.Identifier {
  const file = new Parser().parse(source, new DiagnosticBag())
  const identifier = collectIdentifiers(file)[0]

  if (identifier === undefined) {
    throw new Error('Expected an identifier.')
  }

  return identifier
}

function collectIdentifiers(node: ts.Node): ts.Identifier[] {
  const identifiers: ts.Identifier[] = []

  ts.forEachChild(node, (child) => {
    if (ts.isIdentifier(child)) {
      identifiers.push(child)
    }

    identifiers.push(...collectIdentifiers(child))
  })

  return identifiers
}

describe('Symbol', () => {
  it('starts without references', () => {
    const symbol = createSymbol('value')

    expect(symbol.used).toBe(false)
    expect(symbol.references).toEqual([])
  })

  it('records resolved references', () => {
    const symbol = createSymbol('value')
    symbol.addReference(firstIdentifierOf('value'))

    expect(symbol.references).toHaveLength(1)
    expect(symbol.used).toBe(true)
  })
})
