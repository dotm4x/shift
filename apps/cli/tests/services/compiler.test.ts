import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { compile, compileFile } from '../../source/services/compiler.js'

describe('compile', () => {
  it('generates IR for valid programs', () => {
    const { diagnostics, ir } = compile('let a = 1')

    expect(diagnostics.hasErrors).toBe(false)
    expect(ir).toContain('define i32 @main() {')
  })

  it('collects diagnostics for invalid programs', () => {
    const { diagnostics, ir } = compile('let value = missing')

    expect(diagnostics.hasErrors).toBe(true)
    expect(ir).toBe('')
  })
})

describe('compileFile', () => {
  it('compiles a file from disk', () => {
    const directory = mkdtempSync(join(tmpdir(), 'livescript-'))

    try {
      const file = join(directory, 'sample.ls')
      writeFileSync(file, 'let a = 1')
      const { diagnostics, ir } = compileFile(file)

      expect(diagnostics.hasErrors).toBe(false)
      expect(ir).toContain('define i32 @main() {')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
