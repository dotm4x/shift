import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/main.js')
const clangAvailable = spawnSync('clang', ['--version'], { stdio: 'ignore' }).error === undefined

describe.skipIf(!existsSync(cli) || !clangAvailable)('CLI end-to-end', () => {
  it('builds and runs a program', () => {
    const directory = mkdtempSync(join(tmpdir(), 'livescript-'))

    try {
      const file = join(directory, 'sample.ls')
      writeFileSync(file, 'print("ok")')
      const built = spawnSync(process.execPath, [
        cli,
        'build',
        file,
        '-o',
        join(directory, 'sample'),
      ])

      expect(built.status).toBe(0)

      const ran = spawnSync(join(directory, 'sample'))

      expect(ran.status).toBe(0)
      expect(ran.stdout.toString()).toContain('ok')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('fails for invalid programs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'livescript-'))

    try {
      const file = join(directory, 'broken.ls')
      writeFileSync(file, 'let value = missing')
      const result = spawnSync(process.execPath, [cli, 'run', file])

      expect(result.status).toBe(1)
      expect(result.stderr.toString()).toContain('no-undeclared-reference')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
