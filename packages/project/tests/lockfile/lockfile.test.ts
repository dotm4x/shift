import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createEmptyLockfile,
  currentLockfileVersion,
  LockfileError,
  parseLockfile,
  writeLockfile,
} from '../../source/lockfile/lockfile.js'

describe('parseLockfile', () => {
  it('parses a valid lockfile', () => {
    const lockfile = parseLockfile(
      JSON.stringify({
        lockfileVersion: 1,
        packages: {
          'core@1.0.0': { name: 'core', version: '1.0.0', integrity: 'abc', source: 'local' },
        },
      }),
    )

    expect(lockfile.lockfileVersion).toBe(1)
    expect(lockfile.packages['core@1.0.0']?.name).toBe('core')
  })

  it('rejects invalid JSON', () => {
    expect(() => parseLockfile('{')).toThrow(LockfileError)
  })

  it('rejects a missing lockfileVersion', () => {
    expect(() => parseLockfile('{"packages":{}}')).toThrow(LockfileError)
  })

  it('rejects invalid package entries', () => {
    expect(() =>
      parseLockfile('{"lockfileVersion":1,"packages":{"a@1.0.0":{"name":"a"}}}'),
    ).toThrow(LockfileError)
  })
})

describe('createEmptyLockfile', () => {
  it('creates an empty lockfile with the current version', () => {
    expect(createEmptyLockfile()).toEqual({ lockfileVersion: currentLockfileVersion, packages: {} })
  })
})

describe('writeLockfile', () => {
  it('writes packages sorted by key', () => {
    const directory = mkdtempSync(join(tmpdir(), 'shift-lock-'))
    const path = join(directory, 'project.lock')

    try {
      writeLockfile(path, {
        lockfileVersion: 1,
        packages: {
          'z@1.0.0': { name: 'z', version: '1.0.0', integrity: 'z', source: 'local' },
          'a@1.0.0': { name: 'a', version: '1.0.0', integrity: 'a', source: 'local' },
        },
      })

      const text = readFileSync(path, 'utf8')
      const indexA = text.indexOf('"a@1.0.0"')
      const indexZ = text.indexOf('"z@1.0.0"')

      expect(indexA).toBeGreaterThan(-1)
      expect(indexZ).toBeGreaterThan(indexA)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
