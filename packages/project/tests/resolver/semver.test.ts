import { describe, expect, it } from 'vitest'

import {
  compareSemanticVersions,
  parseSemanticVersion,
  satisfies,
} from '../../source/resolver/semver.js'

describe('parseSemanticVersion', () => {
  it('parses a plain version', () => {
    expect(parseSemanticVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
  })

  it('parses a prerelease version', () => {
    expect(parseSemanticVersion('1.2.3-alpha.1')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['alpha', '1'],
    })
  })

  it('rejects invalid versions', () => {
    expect(parseSemanticVersion('1.2')).toBeUndefined()
    expect(parseSemanticVersion('abc')).toBeUndefined()
  })
})

describe('compareSemanticVersions', () => {
  it('compares by major, minor, and patch', () => {
    const left = parseSemanticVersion('1.2.3')
    const right = parseSemanticVersion('1.3.0')

    expect(
      left !== undefined && right !== undefined && compareSemanticVersions(left, right),
    ).toBeLessThan(0)
  })

  it('orders prerelease below release', () => {
    const left = parseSemanticVersion('1.0.0-alpha')
    const right = parseSemanticVersion('1.0.0')

    expect(
      left !== undefined && right !== undefined && compareSemanticVersions(left, right),
    ).toBeLessThan(0)
  })
})

describe('satisfies', () => {
  it('accepts any version for wildcard constraints', () => {
    expect(satisfies('1.0.0', '*')).toBe(true)
    expect(satisfies('1.0.0', '')).toBe(true)
  })

  it('supports exact constraints', () => {
    expect(satisfies('1.0.0', '1.0.0')).toBe(true)
    expect(satisfies('1.0.1', '1.0.0')).toBe(false)
  })

  it('supports caret constraints', () => {
    expect(satisfies('1.2.9', '^1.2.0')).toBe(true)
    expect(satisfies('2.0.0', '^1.2.0')).toBe(false)
    expect(satisfies('0.2.9', '^0.2.0')).toBe(true)
    expect(satisfies('0.3.0', '^0.2.0')).toBe(false)
  })

  it('supports tilde constraints', () => {
    expect(satisfies('1.2.9', '~1.2.0')).toBe(true)
    expect(satisfies('1.3.0', '~1.2.0')).toBe(false)
  })

  it('supports comparison constraints', () => {
    expect(satisfies('2.0.0', '>=1.0.0')).toBe(true)
    expect(satisfies('0.9.0', '>=1.0.0')).toBe(false)
    expect(satisfies('1.0.0', '<=1.0.0')).toBe(true)
    expect(satisfies('1.0.1', '<1.0.1')).toBe(false)
    expect(satisfies('1.0.2', '>1.0.1')).toBe(true)
  })

  it('supports AND ranges', () => {
    expect(satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true)
    expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false)
  })
})
