import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { typeFromNode } from '../../../source/analyzer/types/syntax.js'
import {
  booleanType,
  f64Type,
  i32Type,
  i64Type,
  stringType,
  voidType,
} from '../../../source/analyzer/types/type.js'
import { Parser } from '../../../source/parser/parser.js'
import { DiagnosticBag } from '../../../source/shared/diagnostics/bag.js'

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

describe('typeFromNode', () => {
  it('converts type keywords', () => {
    expect(typeFromNode(typeNodeOf('string'))).toEqual(stringType)
    expect(typeFromNode(typeNodeOf('boolean'))).toEqual(booleanType)
    expect(typeFromNode(typeNodeOf('void'))).toEqual(voidType)
  })

  it('converts the numeric zoo by name', () => {
    expect(typeFromNode(typeNodeOf('i32'))).toEqual(i32Type)
    expect(typeFromNode(typeNodeOf('i64'))).toEqual(i64Type)
    expect(typeFromNode(typeNodeOf('f64'))).toEqual(f64Type)
    expect(typeFromNode(typeNodeOf('u8'))).toEqual({ kind: 'primitive', name: 'u8' })
    expect(typeFromNode(typeNodeOf('usize'))).toEqual({ kind: 'primitive', name: 'usize' })
  })

  it('rejects the removed number keyword', () => {
    expect(() => typeFromNode(typeNodeOf('number'))).toThrow('was removed')
  })

  it('converts arrays of numeric types', () => {
    expect(typeFromNode(typeNodeOf('i32[]'))).toEqual({ kind: 'array', elementType: i32Type })
  })

  it('converts object types', () => {
    expect(typeFromNode(typeNodeOf('{ name: string; age?: i32 }'))).toEqual({
      kind: 'object',
      properties: [
        { name: 'name', type: stringType, optional: false },
        { name: 'age', type: i32Type, optional: true },
      ],
    })
  })

  it('converts function types', () => {
    expect(typeFromNode(typeNodeOf('(value: i32) => void'))).toEqual({
      kind: 'function',
      parameters: [{ name: 'value', type: i32Type, optional: false }],
      returnType: voidType,
      typeParameters: [],
    })
  })

  it('rejects reference types', () => {
    expect(() => typeFromNode(typeNodeOf('&i32'))).toThrow('Reference types are not supported')
  })
})
