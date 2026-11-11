import { describe, expect, it } from 'vitest'

import { computeLineStarts, getPositionAt } from '../../source/shared/position.js'

describe('computeLineStarts', () => {
  it('returns the offset of every line', () => {
    expect(computeLineStarts('one\ntwo\n\nfour')).toEqual([0, 4, 8, 9])
  })

  it('treats CRLF and CR as single line breaks', () => {
    expect(computeLineStarts('a\r\nb\rc')).toEqual([0, 3, 5])
  })

  it('returns a single line when there is no line break', () => {
    expect(computeLineStarts('single')).toEqual([0])
  })
})

describe('getPositionAt', () => {
  it('converts offsets into zero-based line and character positions', () => {
    const lineStarts = computeLineStarts('one\ntwo\nthree')

    expect(getPositionAt(0, lineStarts)).toEqual({ line: 0, character: 0 })
    expect(getPositionAt(4, lineStarts)).toEqual({ line: 1, character: 0 })
    expect(getPositionAt(11, lineStarts)).toEqual({ line: 2, character: 3 })
  })

  it('falls back to the first line when no line starts are provided', () => {
    expect(getPositionAt(2, [])).toEqual({ line: 0, character: 2 })
  })
})
