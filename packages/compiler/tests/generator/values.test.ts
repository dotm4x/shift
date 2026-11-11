import { describe, expect, it } from 'vitest'

import { formatBoolean, formatDouble, formatStringBytes } from '../../source/generator/values.js'

describe('formatDouble', () => {
  it('formats integers with a decimal part', () => {
    expect(formatDouble(1)).toBe('1.0')
    expect(formatDouble(-2)).toBe('-2.0')
  })

  it('keeps decimal numbers as-is', () => {
    expect(formatDouble(2.5)).toBe('2.5')
    expect(formatDouble(1.5e-7)).toBe('1.5e-7')
  })

  it('adds a decimal part to exponents', () => {
    expect(formatDouble(1e21)).toBe('1.0e+21')
  })

  it('formats special values as hexadecimal bits', () => {
    expect(formatDouble(Number.NaN)).toBe('0x7ff8000000000000')
    expect(formatDouble(Number.POSITIVE_INFINITY)).toBe('0x7ff0000000000000')
  })
})

describe('formatBoolean', () => {
  it('formats booleans as i1 literals', () => {
    expect(formatBoolean(true)).toBe('1')
    expect(formatBoolean(false)).toBe('0')
  })
})

describe('formatStringBytes', () => {
  it('escapes plain text and adds the terminator', () => {
    expect(formatStringBytes('hi')).toEqual({ length: 3, text: 'hi\\00' })
  })

  it('escapes quotes, backslashes and control characters', () => {
    expect(formatStringBytes('a"b')).toEqual({ length: 4, text: 'a\\22b\\00' })
    expect(formatStringBytes('a\\b')).toEqual({ length: 4, text: 'a\\5Cb\\00' })
    expect(formatStringBytes('a\nb')).toEqual({ length: 4, text: 'a\\0Ab\\00' })
  })

  it('encodes non-ascii characters as utf-8', () => {
    expect(formatStringBytes('ñ')).toEqual({ length: 3, text: '\\C3\\B1\\00' })
  })
})
