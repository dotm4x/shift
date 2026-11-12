import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

import {
  booleanType,
  f32Type,
  f64Type,
  i8Type,
  i32Type,
  i64Type,
  stringType,
  u8Type,
  u32Type,
  u64Type,
  usizeType,
} from '../../source/analyzer/types/type.js'
import { irTypeFromNode, irTypeFromType, sizeOf } from '../../source/generator/types.js'
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
  it('maps the numeric zoo', () => {
    expect(irTypeFromType(i8Type)).toBe('i8')
    expect(irTypeFromType(i32Type)).toBe('i32')
    expect(irTypeFromType(i64Type)).toBe('i64')
    expect(irTypeFromType(u8Type)).toBe('i8')
    expect(irTypeFromType(u32Type)).toBe('i32')
    expect(irTypeFromType(u64Type)).toBe('i64')
    expect(irTypeFromType(usizeType)).toBe('i64')
    expect(irTypeFromType(f32Type)).toBe('float')
    expect(irTypeFromType(f64Type)).toBe('double')
  })

  it('maps the other primitives', () => {
    expect(irTypeFromType(booleanType)).toBe('i1')
    expect(irTypeFromType(stringType)).toBe('ptr')
  })

  it('maps tuples to pointers', () => {
    expect(irTypeFromType({ kind: 'tuple', elementTypes: [i32Type] })).toBe('ptr')
  })
})

describe('irTypeFromNode', () => {
  it('maps type nodes from the syntax tree', () => {
    expect(irTypeFromNode(typeNodeOf('i32'))).toBe('i32')
    expect(irTypeFromNode(typeNodeOf('f64'))).toBe('double')
    expect(irTypeFromNode(typeNodeOf('string'))).toBe('ptr')
  })
})

describe('sizeOf', () => {
  it('returns the byte size of types', () => {
    expect(sizeOf(i8Type)).toBe(1)
    expect(sizeOf(i32Type)).toBe(4)
    expect(sizeOf(i64Type)).toBe(8)
    expect(sizeOf(f64Type)).toBe(8)
    expect(sizeOf(stringType)).toBe(8)
    expect(sizeOf(booleanType)).toBe(1)
  })
})
