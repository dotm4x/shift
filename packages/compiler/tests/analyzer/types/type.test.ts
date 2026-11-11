import { describe, expect, it } from 'vitest'

import {
  bigintType,
  booleanType,
  neverType,
  nullType,
  numberType,
  objectType,
  stringType,
  undefinedType,
  uniqueSymbolType,
  unknownType,
  voidType,
} from '../../../source/analyzer/types/type.js'

describe('primitive types', () => {
  it('exposes every primitive', () => {
    const names = [
      bigintType,
      booleanType,
      nullType,
      numberType,
      objectType,
      stringType,
      undefinedType,
    ].map((type) => type.name)

    expect(names).toEqual(['bigint', 'boolean', 'null', 'number', 'object', 'string', 'undefined'])
  })

  it('exposes the special types', () => {
    expect(neverType.kind).toBe('never')
    expect(unknownType.kind).toBe('unknown')
    expect(voidType.kind).toBe('void')
    expect(uniqueSymbolType.kind).toBe('uniqueSymbol')
  })
})
