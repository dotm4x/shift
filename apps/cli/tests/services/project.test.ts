import { describe, expect, it } from 'vitest'

import { parseProjectManifest } from '@shift/project'

import {
  entryOf,
  matchesFilters,
  outputOf,
  resolveBaseDirectory,
} from '../../source/services/project.js'

describe('matchesFilters', () => {
  it('matches every project when no filters are given', () => {
    expect(matchesFilters('any')).toBe(true)
    expect(matchesFilters('any', [])).toBe(true)
  })

  it('matches by exact name', () => {
    expect(matchesFilters('@calculator/calc', ['@calculator/calc'])).toBe(true)
    expect(matchesFilters('@calculator/calc', ['@calculator/mathlib'])).toBe(false)
  })

  it('matches by glob pattern', () => {
    expect(matchesFilters('@calculator/calc', ['@calculator/*'])).toBe(true)
    expect(matchesFilters('@calculator/calc/extra', ['@calculator/*'])).toBe(false)
    expect(matchesFilters('core', ['c*'])).toBe(true)
    expect(matchesFilters('core', ['x*'])).toBe(false)
  })

  it('matches when any filter matches', () => {
    expect(matchesFilters('core', ['api', 'c*'])).toBe(true)
  })
})

describe('entryOf', () => {
  it('returns the declared entry', () => {
    const manifest = parseProjectManifest('{"name":"a","version":"1.0.0","entry":"src/main.shift"}')

    expect(entryOf(manifest)).toBe('src/main.shift')
  })

  it('defaults by project type', () => {
    const executable = parseProjectManifest('{"name":"a","version":"1.0.0","type":"executable"}')
    const library = parseProjectManifest('{"name":"a","version":"1.0.0","type":"library"}')

    expect(entryOf(executable)).toBe('src/main.shift')
    expect(entryOf(library)).toBe('src/index.shift')
  })
})

describe('outputOf', () => {
  it('uses the configured output directory and the last name segment', () => {
    const manifest = parseProjectManifest(
      '{"name":"@calculator/calc","version":"1.0.0","build":{"output":"out"}}',
    )

    expect(outputOf(manifest, '/root')).toBe('/root/out/calc')
  })

  it('defaults to the build directory', () => {
    const manifest = parseProjectManifest('{"name":"calc","version":"1.0.0"}')

    expect(outputOf(manifest, '/root')).toBe('/root/build/calc')
  })
})

describe('resolveBaseDirectory', () => {
  it('resolves an absolute path option', () => {
    expect(resolveBaseDirectory('/tmp')).toBe('/tmp')
  })

  it('resolves a relative path option against the invocation directory', () => {
    expect(resolveBaseDirectory('sub')).toContain('sub')
  })
})
