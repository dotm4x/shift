import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { booleanType, numberType, stringType, voidType } from '../../source/analyzer/types/type.js'
import {
  irKindFromType,
  irTypeFromKind,
  irTypeFromNode,
  irTypeFromType,
} from '../../source/generator/types.js'
import { Parser } from '../../source/parser/parser.js'
import { DiagnosticBag } from '../../source/shared/diagnostics/bag.js'

function typeNodeOf(source: string): ts.TypeNode {
  const file = new Parser().parse(`let value: ${source}`, new DiagnosticBag())
  const statement = file.statements[0]

  if (statement === undefined || !ts.isVariableStatement(statement)) {
    throw new Error('Expected a variable statement.')
  }

  const declaration = statement.declarationList.declarations[0]

  if (declaration?.type === undefined) {
    throw new Error('Expected a typed declaration.')
  }

  return declaration.type
}

describe('irTypeFromType', () => {
  it('maps supported language types', () => {
    expect(irTypeFromType(numberType)).toBe('double')
    expect(irTypeFromType(booleanType)).toBe('i1')
    expect(irTypeFromType(stringType)).toBe('ptr')
    expect(irTypeFromType(voidType)).toBe('void')
  })

  it('throws for unsupported language types', () => {
    expect(() => irTypeFromType({ kind: 'tuple', elementTypes: [numberType] })).toThrow(
      'Unsupported type for code generation',
    )
  })
})

describe('irTypeFromNode', () => {
  it('maps type nodes from the syntax tree', () => {
    expect(irTypeFromNode(typeNodeOf('number'))).toBe('double')
    expect(irTypeFromNode(typeNodeOf('string'))).toBe('ptr')
    expect(irTypeFromNode(typeNodeOf('boolean'))).toBe('i1')
  })
})

describe('kind conversions', () => {
  it('maps kinds to IR types and back', () => {
    expect(irTypeFromKind('number')).toBe('double')
    expect(irTypeFromKind('boolean')).toBe('i1')
    expect(irTypeFromKind('string')).toBe('ptr')
    expect(irTypeFromKind('void')).toBe('void')

    expect(irKindFromType('double')).toBe('number')
    expect(irKindFromType('i1')).toBe('boolean')
    expect(irKindFromType('ptr')).toBe('string')
    expect(irKindFromType('void')).toBe('void')
  })
})
