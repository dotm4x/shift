import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Fails when clang is not available.
 *
 * @throws When clang is missing from the system.
 */
export function requireClang(): void {
  const result = spawnSync('clang', ['--version'], { stdio: 'ignore' })

  if (result.error !== undefined) {
    throw new Error('clang is required to build executables. Install it with your package manager.')
  }
}

/**
 * Compiles LLVM IR text into a native executable. The intermediate IR file lives in a temporary
 * directory that is removed afterwards.
 *
 * @param ir LLVM IR text.
 * @param outputPath Path of the executable to produce.
 * @returns The exit status of clang.
 */
export function buildExecutable(ir: string, outputPath: string): number {
  const directory = mkdtempSync(join(tmpdir(), 'livescript-'))

  try {
    const irPath = join(directory, 'output.ll')
    writeFileSync(irPath, ir)

    const result = spawnSync('clang', ['-Wno-override-module', irPath, '-o', outputPath, '-lgc'], {
      stdio: 'inherit',
    })

    return result.status ?? 1
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

/**
 * Compiles several LLVM IR modules into object files and links them into a native executable.
 *
 * @param modules Compiled modules with their LLVM IR text, dependencies first.
 * @param outputPath Path of the executable to produce.
 * @returns The exit status of clang.
 */
export function buildModules(
  modules: readonly { readonly path: string; readonly ir: string }[],
  outputPath: string,
): number {
  const directory = mkdtempSync(join(tmpdir(), 'livescript-'))

  try {
    mkdirSync(dirname(outputPath), { recursive: true })
    const objects: string[] = []

    for (const [index, module] of modules.entries()) {
      const irPath = join(directory, `module${String(index)}.ll`)
      const objectPath = join(directory, `module${String(index)}.o`)
      writeFileSync(irPath, module.ir)

      const compiled = spawnSync(
        'clang',
        ['-Wno-override-module', '-c', irPath, '-o', objectPath],
        { stdio: 'inherit' },
      )

      if ((compiled.status ?? 1) !== 0) {
        return compiled.status ?? 1
      }

      objects.push(objectPath)
    }

    const linked = spawnSync(
      'clang',
      ['-Wno-override-module', ...objects, '-o', outputPath, '-lgc'],
      { stdio: 'inherit' },
    )

    return linked.status ?? 1
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

/**
 * Compiles several LLVM IR modules into a temporary executable, runs it and removes it.
 *
 * @param modules Compiled modules with their LLVM IR text, dependencies first.
 * @returns The exit status of the executable, or of clang when the build fails.
 */
export function buildAndRunModules(
  modules: readonly { readonly path: string; readonly ir: string }[],
): number {
  const directory = mkdtempSync(join(tmpdir(), 'livescript-'))

  try {
    const executable = join(directory, 'program')
    const status = buildModules(modules, executable)

    if (status !== 0) {
      return status
    }

    const result = spawnSync(executable, { stdio: 'inherit' })

    return result.status ?? 1
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

/**
 * Compiles LLVM IR text into a temporary executable, runs it and removes it.
 *
 * @param ir LLVM IR text.
 * @returns The exit status of the executable, or of clang when the build fails.
 */
export function buildAndRun(ir: string): number {
  const directory = mkdtempSync(join(tmpdir(), 'livescript-'))

  try {
    const executable = join(directory, 'program')
    const status = buildExecutable(ir, executable)

    if (status !== 0) {
      return status
    }

    const result = spawnSync(executable, { stdio: 'inherit' })

    return result.status ?? 1
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}
