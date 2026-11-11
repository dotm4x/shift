import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildAndRun, buildExecutable, requireClang } from '../../source/services/clang.js'
import { compile } from '../../source/services/compiler.js'

const clangAvailable = spawnSync('clang', ['--version'], { stdio: 'ignore' }).error === undefined
const ir = compile('let a = 1').ir

describe('requireClang', () => {
  it('detects the clang toolchain', () => {
    if (clangAvailable) {
      expect(() => {
        requireClang()
      }).not.toThrow()

      return
    }

    expect(() => {
      requireClang()
    }).toThrow('clang is required')
  })
})

describe.skipIf(!clangAvailable)('buildExecutable', () => {
  it('produces a runnable executable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'livescript-'))

    try {
      const executable = join(directory, 'program')

      expect(buildExecutable(ir, executable)).toBe(0)
      expect(existsSync(executable)).toBe(true)
      expect(spawnSync(executable).status).toBe(0)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('reports clang failures', () => {
    const directory = mkdtempSync(join(tmpdir(), 'livescript-'))

    try {
      expect(buildExecutable('this is not llvm ir', join(directory, 'program'))).not.toBe(0)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})

describe.skipIf(!clangAvailable)('buildAndRun', () => {
  it('builds, runs and returns the exit status', () => {
    expect(buildAndRun(ir)).toBe(0)
  })
})
