import { describe, expect, it } from 'vitest'

import {
  booleanType,
  f32Type,
  f64Type,
  i8Type,
  i16Type,
  i32Type,
  i64Type,
  stringType,
  u8Type,
  u16Type,
  u32Type,
  u64Type,
  usizeType,
} from '../../../source/analyzer/types/type.js'

describe('primitive types', () => {
  it('exposes the numeric zoo', () => {
    const names = [
      f32Type,
      f64Type,
      i16Type,
      i32Type,
      i64Type,
      i8Type,
      u16Type,
      u32Type,
      u64Type,
      u8Type,
      usizeType,
    ].map((type) => type.name)

    expect(names).toEqual([
      'f32',
      'f64',
      'i16',
      'i32',
      'i64',
      'i8',
      'u16',
      'u32',
      'u64',
      'u8',
      'usize',
    ])
  })

  it('exposes the other primitives', () => {
    expect(booleanType.name).toBe('boolean')
    expect(stringType.name).toBe('string')
  })
})
