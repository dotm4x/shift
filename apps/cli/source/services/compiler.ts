import { readFileSync } from 'node:fs'

import { Analyzer, DiagnosticBag, Generator, Linter, Parser } from '@livescript/compiler'

import { resolveInvocationPath } from './paths.js'

/** Result of running the compiler pipeline over Livescript source text. */
export interface CompileResult {
  readonly diagnostics: DiagnosticBag
  readonly ir: string
}

/** Options of the compiler pipeline. */
export interface CompileOptions {
  /** Names available in the global scope without being declared. */
  readonly globals?: readonly string[] | undefined
}

/**
 * Runs the compiler pipeline over Livescript source text.
 *
 * @param source Livescript source text.
 * @param options Pipeline options.
 * @returns Diagnostics of the pipeline and the generated LLVM IR, which is empty when the
 * pipeline reports errors.
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const diagnostics = new DiagnosticBag()
  const sourceFile = new Parser().parse(source, diagnostics)

  new Linter().lint(sourceFile, diagnostics)
  new Analyzer({ globals: options.globals }).analyze(sourceFile, diagnostics)

  if (diagnostics.hasErrors) {
    return { diagnostics, ir: '' }
  }

  return { diagnostics, ir: new Generator().generate(sourceFile, { globals: options.globals }) }
}

/**
 * Reads a Livescript file and runs the compiler pipeline over it.
 *
 * @param file Path of the Livescript source file.
 * @param options Pipeline options.
 * @returns Diagnostics of the pipeline and the generated LLVM IR.
 */
export function compileFile(file: string, options: CompileOptions = {}): CompileResult {
  return compile(readFileSync(resolveInvocationPath(file), 'utf8'), options)
}
