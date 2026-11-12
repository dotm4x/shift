import { describe, expect, it } from 'vitest'

import { isAssignableTo } from '../../../source/analyzer/types/assignability.js'
import {
  booleanType,
  f32Type,
  f64Type,
  i8Type,
  i32Type,
  i64Type,
  stringType,
  type Type,
  u8Type,
  usizeType,
  voidType,
} from '../../../source/analyzer/types/type.js'

function literalOf(
  primitive: 'boolean' | 'f64' | 'i32' | 'i64' | 'string',
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
    expect(isAssignableTo(i32Type, i32Type)).toBe(true)
    expect(isAssignableTo(i32Type, i64Type)).toBe(false)
    expect(isAssignableTo(i8Type, i32Type)).toBe(false)
    expect(isAssignableTo(f64Type, f32Type)).toBe(false)
    expect(isAssignableTo(usizeType, u8Type)).toBe(false)
  })

  it('widens literals to their primitive', () => {
    expect(isAssignableTo(literalOf('string', 'hi'), stringType)).toBe(true)
    expect(isAssignableTo(literalOf('i32', 42), i32Type)).toBe(true)
    expect(isAssignableTo(literalOf('i32', 42), i64Type)).toBe(false)
    expect(isAssignableTo(literalOf('f64', 2.5), f64Type)).toBe(true)
    expect(isAssignableTo(literalOf('boolean', true), booleanType)).toBe(true)
  })

  it('compares literals by value', () => {
    expect(isAssignableTo(literalOf('string', 'hi'), literalOf('string', 'hi'))).toBe(true)
    expect(isAssignableTo(literalOf('string', 'hi'), literalOf('string', 'ho'))).toBe(false)
  })

  it('treats unknown as the top type', () => {
    expect(isAssignableTo(i32Type, { kind: 'unknown' })).toBe(true)
    expect(isAssignableTo({ kind: 'unknown' }, i32Type)).toBe(false)
  })

  it('treats never as the bottom type', () => {
    expect(isAssignableTo({ kind: 'never' }, i32Type)).toBe(true)
    expect(isAssignableTo(i32Type, { kind: 'never' })).toBe(false)
  })

  it('distributes unions', () => {
    const stringOrNumber: Type = { kind: 'union', types: [stringType, i32Type] }

    expect(isAssignableTo(i32Type, stringOrNumber)).toBe(true)
    expect(isAssignableTo(booleanType, stringOrNumber)).toBe(false)
    expect(isAssignableTo(stringOrNumber, i32Type)).toBe(false)
  })

  it('compares arrays by their element type', () => {
    const numbers: Type = { kind: 'array', elementType: i32Type }

    expect(isAssignableTo(numbers, { kind: 'array', elementType: i32Type })).toBe(true)
    expect(isAssignableTo(numbers, { kind: 'array', elementType: f64Type })).toBe(false)
    expect(isAssignableTo(numbers, stringType)).toBe(false)
  })

  it('allows extra properties on objects', () => {
    const person = objectOf({ name: stringType, age: i32Type })

    expect(isAssignableTo(person, objectOf({ name: stringType }))).toBe(true)
    expect(isAssignableTo(objectOf({ name: stringType }), person)).toBe(false)
  })

  it('allows missing optional properties', () => {
    const target: Type = {
      kind: 'object',
      properties: [{ name: 'age', type: i32Type, optional: true }],
    }

    expect(isAssignableTo(objectOf({ name: stringType }), target)).toBe(true)
  })

  it('checks function parameters contravariantly', () => {
    const acceptsBoth: Type = { kind: 'union', types: [i32Type, stringType] }

    expect(
      isAssignableTo(functionOf([acceptsBoth], voidType), functionOf([i32Type], voidType)),
    ).toBe(true)
    expect(
      isAssignableTo(functionOf([i32Type], voidType), functionOf([acceptsBoth], voidType)),
    ).toBe(false)
  })

  it('compares references by name and type arguments', () => {
    const point: Type = { kind: 'reference', name: 'Point', typeArguments: [] }
    const boxOf = (type: Type): Type => ({ kind: 'reference', name: 'Box', typeArguments: [type] })

    expect(isAssignableTo(point, point)).toBe(true)
    expect(isAssignableTo(point, { kind: 'reference', name: 'Point2D', typeArguments: [] })).toBe(
      false,
    )
    expect(isAssignableTo(boxOf(i32Type), boxOf(i32Type))).toBe(true)
    expect(isAssignableTo(boxOf(i32Type), boxOf(stringType))).toBe(false)
  })
})
