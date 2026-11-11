import { describe, expect, it } from 'vitest'

import { isAssignableTo } from '../../../source/analyzer/types/assignability.js'
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

function literalOf(
  primitive: 'boolean' | 'number' | 'string',
  value: string | number | boolean,
): Type {
  return { kind: 'literal', primitive, value }
}

function objectOf(properties: { [name: string]: Type }): Type {
  return {
    kind: 'object',
    properties: Object.entries(properties).map(([name, type]) => ({ name, type, optional: false })),
  }
}

function functionOf(parameters: readonly Type[], returnType: Type): Type {
  return {
    kind: 'function',
    parameters: parameters.map((type, index) => ({
      name: `p${String(index)}`,
      type,
      optional: false,
    })),
    returnType,
  }
}

describe('isAssignableTo', () => {
  it('compares primitives by name', () => {
    expect(isAssignableTo(numberType, numberType)).toBe(true)
    expect(isAssignableTo(numberType, stringType)).toBe(false)
    expect(isAssignableTo(stringType, numberType)).toBe(false)
    expect(isAssignableTo(nullType, nullType)).toBe(true)
    expect(isAssignableTo(nullType, undefinedType)).toBe(false)
    expect(isAssignableTo(undefinedType, undefinedType)).toBe(true)
  })

  it('widens literals to their primitive', () => {
    expect(isAssignableTo(literalOf('string', 'hi'), stringType)).toBe(true)
    expect(isAssignableTo(literalOf('string', 'hi'), numberType)).toBe(false)
    expect(isAssignableTo(literalOf('number', 42), numberType)).toBe(true)
    expect(isAssignableTo(literalOf('boolean', true), booleanType)).toBe(true)
  })

  it('compares literals by value', () => {
    expect(isAssignableTo(literalOf('string', 'hi'), literalOf('string', 'hi'))).toBe(true)
    expect(isAssignableTo(literalOf('string', 'hi'), literalOf('string', 'ho'))).toBe(false)
  })

  it('treats unknown as the top type', () => {
    expect(isAssignableTo(numberType, unknownType)).toBe(true)
    expect(isAssignableTo(unknownType, numberType)).toBe(false)
  })

  it('treats never as the bottom type', () => {
    expect(isAssignableTo(neverType, numberType)).toBe(true)
    expect(isAssignableTo(numberType, neverType)).toBe(false)
  })

  it('accepts undefined and void for void targets', () => {
    expect(isAssignableTo(voidType, voidType)).toBe(true)
    expect(isAssignableTo(undefinedType, voidType)).toBe(true)
    expect(isAssignableTo(numberType, voidType)).toBe(false)
    expect(isAssignableTo(voidType, numberType)).toBe(false)
  })

  it('distributes unions', () => {
    const stringOrNumber: Type = { kind: 'union', types: [stringType, numberType] }

    expect(isAssignableTo(numberType, stringOrNumber)).toBe(true)
    expect(isAssignableTo(booleanType, stringOrNumber)).toBe(false)
    expect(isAssignableTo(stringOrNumber, numberType)).toBe(false)
    expect(isAssignableTo(literalOf('number', 1), numberType)).toBe(true)
  })

  it('checks intersections member by member', () => {
    const numbered = objectOf({ value: numberType })
    const named = objectOf({ name: stringType })
    const both: Type = { kind: 'intersection', types: [numbered, named] }

    expect(isAssignableTo(both, numbered)).toBe(true)
    expect(
      isAssignableTo(numberType, { kind: 'intersection', types: [numberType, unknownType] }),
    ).toBe(true)
    expect(
      isAssignableTo(numberType, { kind: 'intersection', types: [numberType, stringType] }),
    ).toBe(false)
  })

  it('compares arrays by their element type', () => {
    const numbers: Type = { kind: 'array', elementType: numberType }

    expect(isAssignableTo(numbers, { kind: 'array', elementType: numberType })).toBe(true)
    expect(isAssignableTo(numbers, { kind: 'array', elementType: stringType })).toBe(false)
    expect(isAssignableTo(numbers, stringType)).toBe(false)
  })

  it('allows extra properties on objects', () => {
    const person = objectOf({ name: stringType, age: numberType })

    expect(isAssignableTo(person, objectOf({ name: stringType }))).toBe(true)
    expect(isAssignableTo(objectOf({ name: stringType }), person)).toBe(false)
  })

  it('requires every target property', () => {
    expect(
      isAssignableTo(
        objectOf({ name: stringType }),
        objectOf({ name: stringType, age: numberType }),
      ),
    ).toBe(false)
  })

  it('allows missing optional properties', () => {
    const target: Type = {
      kind: 'object',
      properties: [{ name: 'age', type: numberType, optional: true }],
    }

    expect(isAssignableTo(objectOf({ name: stringType }), target)).toBe(true)
  })

  it('rejects optional properties for required targets', () => {
    const source: Type = {
      kind: 'object',
      properties: [{ name: 'age', type: numberType, optional: true }],
    }

    expect(isAssignableTo(source, objectOf({ age: numberType }))).toBe(false)
  })

  it('checks nested property types', () => {
    expect(
      isAssignableTo(
        objectOf({ position: objectOf({ x: numberType }) }),
        objectOf({ position: objectOf({ x: numberType }) }),
      ),
    ).toBe(true)
    expect(
      isAssignableTo(
        objectOf({ position: objectOf({ x: numberType }) }),
        objectOf({ position: objectOf({ x: stringType }) }),
      ),
    ).toBe(false)
  })

  it('allows functions with fewer parameters', () => {
    const target: Type = {
      kind: 'function',
      parameters: [
        { name: 'first', type: numberType, optional: false },
        { name: 'second', type: numberType, optional: true },
      ],
      returnType: voidType,
    }

    expect(isAssignableTo(functionOf([numberType], voidType), target)).toBe(true)
    expect(
      isAssignableTo(
        functionOf([numberType, numberType], voidType),
        functionOf([numberType], voidType),
      ),
    ).toBe(false)
  })

  it('checks function parameters contravariantly', () => {
    const acceptsBoth: Type = { kind: 'union', types: [numberType, stringType] }

    expect(
      isAssignableTo(functionOf([acceptsBoth], voidType), functionOf([numberType], voidType)),
    ).toBe(true)
    expect(
      isAssignableTo(functionOf([numberType], voidType), functionOf([acceptsBoth], voidType)),
    ).toBe(false)
  })

  it('checks function return types covariantly', () => {
    const numberOrString: Type = { kind: 'union', types: [numberType, stringType] }

    expect(isAssignableTo(functionOf([], numberType), functionOf([], numberOrString))).toBe(true)
    expect(isAssignableTo(functionOf([], numberOrString), functionOf([], numberType))).toBe(false)
  })

  it('accepts any return type for void targets', () => {
    expect(isAssignableTo(functionOf([], numberType), functionOf([], voidType))).toBe(true)
  })

  it('compares tuples element by element', () => {
    const pair: Type = { kind: 'tuple', elementTypes: [stringType, numberType] }

    expect(isAssignableTo(pair, { kind: 'tuple', elementTypes: [stringType, numberType] })).toBe(
      true,
    )
    expect(isAssignableTo(pair, { kind: 'tuple', elementTypes: [numberType, stringType] })).toBe(
      false,
    )
    expect(isAssignableTo(pair, { kind: 'tuple', elementTypes: [stringType] })).toBe(false)
  })

  it('compares enums by name', () => {
    const color: Type = { kind: 'enum', name: 'Color' }

    expect(isAssignableTo(color, { kind: 'enum', name: 'Color' })).toBe(true)
    expect(isAssignableTo(color, { kind: 'enum', name: 'Shape' })).toBe(false)
  })

  it('compares unique symbols only with themselves', () => {
    expect(isAssignableTo(uniqueSymbolType, uniqueSymbolType)).toBe(true)
    expect(isAssignableTo(uniqueSymbolType, stringType)).toBe(false)
  })

  it('accepts non-primitive values for object', () => {
    expect(isAssignableTo(objectOf({ name: stringType }), objectType)).toBe(true)
    expect(isAssignableTo({ kind: 'array', elementType: numberType }, objectType)).toBe(true)
    expect(isAssignableTo(functionOf([], voidType), objectType)).toBe(true)
    expect(isAssignableTo(numberType, objectType)).toBe(false)
    expect(isAssignableTo(literalOf('string', 'hi'), objectType)).toBe(false)
    expect(isAssignableTo(nullType, objectType)).toBe(false)
  })

  it('compares bigint primitives by name', () => {
    expect(isAssignableTo(bigintType, bigintType)).toBe(true)
    expect(isAssignableTo(bigintType, numberType)).toBe(false)
  })

  it('matches string literals against template literal types', () => {
    const greeting: Type = { kind: 'templateLiteral', parts: ['hi ', stringType] }

    expect(isAssignableTo(literalOf('string', 'hi there'), greeting)).toBe(true)
    expect(isAssignableTo(literalOf('string', 'hi '), greeting)).toBe(true)
    expect(isAssignableTo(literalOf('string', 'hello there'), greeting)).toBe(false)
  })

  it('matches numbers inside template literal types', () => {
    const pixels: Type = { kind: 'templateLiteral', parts: [numberType, 'px'] }

    expect(isAssignableTo(literalOf('string', '42px'), pixels)).toBe(true)
    expect(isAssignableTo(literalOf('string', 'widepx'), pixels)).toBe(false)
  })

  it('compares template literal types by their parts', () => {
    const greeting: Type = { kind: 'templateLiteral', parts: ['hi ', stringType] }

    expect(isAssignableTo(greeting, stringType)).toBe(true)
    expect(isAssignableTo(greeting, { kind: 'templateLiteral', parts: ['hi ', stringType] })).toBe(
      true,
    )
    expect(isAssignableTo(greeting, { kind: 'templateLiteral', parts: ['ho ', stringType] })).toBe(
      false,
    )
  })

  it('checks conditional types through both branches', () => {
    const stringOrNumber: Type = { kind: 'union', types: [stringType, numberType] }
    const conditional: Type = {
      kind: 'conditional',
      checkType: numberType,
      extendsType: numberType,
      trueType: stringType,
      falseType: numberType,
    }

    expect(isAssignableTo(conditional, stringOrNumber)).toBe(true)
    expect(isAssignableTo(conditional, stringType)).toBe(false)
    expect(isAssignableTo(stringType, conditional)).toBe(false)
    expect(isAssignableTo(numberType, conditional)).toBe(false)
  })

  it('compares mapped types structurally', () => {
    const names: Type = {
      kind: 'mapped',
      parameter: 'K',
      constraint: stringType,
      nameType: undefined,
      template: numberType,
    }
    const same: Type = {
      kind: 'mapped',
      parameter: 'K',
      constraint: stringType,
      nameType: undefined,
      template: numberType,
    }
    const other: Type = {
      kind: 'mapped',
      parameter: 'K',
      constraint: stringType,
      nameType: undefined,
      template: stringType,
    }

    expect(isAssignableTo(names, same)).toBe(true)
    expect(isAssignableTo(names, other)).toBe(false)
  })

  it('compares references by name and type arguments', () => {
    const point: Type = { kind: 'reference', name: 'Point', typeArguments: [] }
    const boxOf = (type: Type): Type => ({ kind: 'reference', name: 'Box', typeArguments: [type] })

    expect(isAssignableTo(point, point)).toBe(true)
    expect(isAssignableTo(point, { kind: 'reference', name: 'Point2D', typeArguments: [] })).toBe(
      false,
    )
    expect(isAssignableTo(boxOf(numberType), boxOf(numberType))).toBe(true)
    expect(isAssignableTo(boxOf(numberType), boxOf(stringType))).toBe(false)
  })
})
