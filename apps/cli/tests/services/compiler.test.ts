import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { compile, compileFile, compileModuleGraph } from '../../source/services/compiler.js'
import { collectModuleGraph } from '../../source/services/modules.js'

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
    const directory = mkdtempSync(join(tmpdir(), 'shift-'))

    try {
      const file = join(directory, 'sample.shift')
      writeFileSync(file, 'let a = 1')
      const { diagnostics, ir } = compileFile(file)

      expect(diagnostics.hasErrors).toBe(false)
      expect(ir).toContain('define i32 @main() {')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})

describe('compileModuleGraph', () => {
  function createPackage(directory: string, source: string): Map<string, string> {
    const packageRoot = join(directory, 'mathlib')
    mkdirSync(join(packageRoot, 'src'), { recursive: true })
    writeFileSync(
      join(packageRoot, 'project.json'),
      '{"name":"mathlib","version":"1.0.0","type":"library"}',
    )
    writeFileSync(join(packageRoot, 'src', 'index.shift'), source)

    return new Map([['mathlib', packageRoot]])
  }

  it('compiles an importer against the exported functions of its dependency', () => {
    const directory = mkdtempSync(join(tmpdir(), 'shift-modules-'))

    try {
      const packages = createPackage(
        directory,
        'export function double(value: i32): i32 {\n  return value * 2\n}',
      )
      const entry = join(directory, 'main.shift')
      writeFileSync(entry, 'import { double } from "mathlib"\n\nprint(double(2))')

      const modules = compileModuleGraph(collectModuleGraph(entry, packages), packages)

      expect(modules).toHaveLength(2)
      expect(modules[1]?.ir).toContain('declare i32 @double(i32)')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('rejects imports of names the dependency does not export', () => {
    const directory = mkdtempSync(join(tmpdir(), 'shift-modules-'))

    try {
      const packages = createPackage(
        directory,
        'export function double(value: i32): i32 {\n  return value * 2\n}',
      )
      const entry = join(directory, 'main.shift')
      writeFileSync(entry, 'import { missing } from "mathlib"\n\nprint(missing(2))')

      expect(() => compileModuleGraph(collectModuleGraph(entry, packages), packages)).toThrow(
        /does not export 'missing'/,
      )
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
