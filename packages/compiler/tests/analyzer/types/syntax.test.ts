import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { typeFromNode } from '../../../source/analyzer/types/syntax.js'
import {
  bigintType,
  booleanType,
  neverType,
  nullType,
  numberType,
  objectType,
  stringType,
  type Type,
  undefinedType,
  uniqueSymbolType,
  unknownType,
  voidType,
} from '../../../source/analyzer/types/type.js'
import { Parser } from '../../../source/parser/parser.js'
import { DiagnosticBag } from '../../../source/shared/diagnostics/bag.js'

function typeOf(source: string): Type {
  const file = new Parser().parse(`let value: ${source}`, new DiagnosticBag())
  const statement = file.statements[0]

  if (statement === undefined || !ts.isVariableStatement(statement)) {
    throw new Error('Expected a variable statement.')
  }

  const declaration = statement.declarationList.declarations[0]

  if (declaration?.type === undefined) {
    throw new Error('Expected a typed declaration.')
  }

  return typeFromNode(declaration.type)
}

describe('typeFromNode', () => {
  it('converts type keywords', () => {
    expect(typeOf('number')).toEqual(numberType)
    expect(typeOf('string')).toEqual(stringType)
    expect(typeOf('boolean')).toEqual(booleanType)
    expect(typeOf('null')).toEqual(nullType)
    expect(typeOf('undefined')).toEqual(undefinedType)
    expect(typeOf('unknown')).toEqual(unknownType)
    expect(typeOf('never')).toEqual(neverType)
    expect(typeOf('void')).toEqual(voidType)
    expect(typeOf('any')).toEqual(unknownType)
  })

  it('converts literal types', () => {
    expect(typeOf('"hi"')).toEqual({ kind: 'literal', primitive: 'string', value: 'hi' })
    expect(typeOf('42')).toEqual({ kind: 'literal', primitive: 'number', value: 42 })
    expect(typeOf('true')).toEqual({ kind: 'literal', primitive: 'boolean', value: true })
  })

  it('converts arrays and unions', () => {
    expect(typeOf('number[]')).toEqual({ kind: 'array', elementType: numberType })
    expect(typeOf('string | number')).toEqual({ kind: 'union', types: [stringType, numberType] })
    expect(typeOf('string & number')).toEqual({
      kind: 'intersection',
      types: [stringType, numberType],
    })
  })

  it('converts object types', () => {
    expect(typeOf('{ name: string; age?: number }')).toEqual({
      kind: 'object',
      properties: [
        { name: 'name', type: stringType, optional: false },
        { name: 'age', type: numberType, optional: true },
      ],
    })
  })

  it('converts object methods into function properties', () => {
    expect(typeOf('{ run(speed: number): void }')).toEqual({
      kind: 'object',
      properties: [
        {
          name: 'run',
          type: {
            kind: 'function',
            parameters: [{ name: 'speed', type: numberType, optional: false }],
            returnType: voidType,
            typeParameters: [],
          },
          optional: false,
        },
      ],
    })
  })

  it('converts function types', () => {
    expect(typeOf('(value: number) => void')).toEqual({
      kind: 'function',
      parameters: [{ name: 'value', type: numberType, optional: false }],
      returnType: voidType,
      typeParameters: [],
    })
  })

  it('converts type references', () => {
    expect(typeOf('Point')).toEqual({ kind: 'reference', name: 'Point', typeArguments: [] })
    expect(typeOf('Box<number>')).toEqual({
      kind: 'reference',
      name: 'Box',
      typeArguments: [numberType],
    })
  })

  it('converts object and bigint keywords', () => {
    expect(typeOf('object')).toEqual(objectType)
    expect(typeOf('bigint')).toEqual(bigintType)
  })

  it('converts unique symbol types', () => {
    expect(typeOf('unique symbol')).toEqual(uniqueSymbolType)
  })

  it('converts tuples', () => {
    expect(typeOf('[string, number]')).toEqual({
      kind: 'tuple',
      elementTypes: [stringType, numberType],
    })
  })

  it('converts template literal types', () => {
    expect(typeOf('`hi ${string}`')).toEqual({
      kind: 'templateLiteral',
      parts: ['hi ', stringType, ''],
    })
  })

  it('converts conditional types', () => {
    expect(typeOf('number extends string ? string : number')).toEqual({
      kind: 'conditional',
      checkType: numberType,
      extendsType: stringType,
      trueType: stringType,
      falseType: numberType,
    })
  })

  it('converts mapped types', () => {
    expect(typeOf('{ [K in string]: number }')).toEqual({
      kind: 'mapped',
      parameter: 'K',
      constraint: stringType,
      nameType: undefined,
      template: numberType,
    })
  })

  it('converts generic function types with constraints', () => {
    expect(typeOf('<T extends number>(value: T) => T')).toEqual({
      kind: 'function',
      parameters: [
        {
          name: 'value',
          type: { kind: 'reference', name: 'T', typeArguments: [] },
          optional: false,
        },
      ],
      returnType: { kind: 'reference', name: 'T', typeArguments: [] },
      typeParameters: [{ name: 'T', constraint: numberType, defaultType: undefined }],
    })
  })

  it('throws for unsupported type syntax', () => {
    expect(() => typeOf('typeof Point')).toThrow('Unsupported type syntax')
  })
})
