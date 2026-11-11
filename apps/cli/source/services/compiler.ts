import { readFileSync } from 'node:fs'

import { Analyzer, DiagnosticBag, Generator, Linter, Parser } from '@livescript/compiler'

import { resolveInvocationPath } from './paths.js'

/** Result of running the compiler pipeline over Livescript source text. */
export interface CompileResult {
  readonly diagnostics: DiagnosticBag
  readonly ir: string
}

/**
 * Runs the compiler pipeline over Livescript source text.
 *
 * @param source Livescript source text.
 * @returns Diagnostics of the pipeline and the generated LLVM IR.
 */
export function compile(source: string): CompileResult {
  const diagnostics = new DiagnosticBag()
  const sourceFile = new Parser().parse(source, diagnostics)

  new Linter().lint(sourceFile, diagnostics)
  new Analyzer().analyze(sourceFile, diagnostics)

  return { diagnostics, ir: new Generator().generate(sourceFile) }
}

/**
 * Reads a Livescript file and runs the compiler pipeline over it.
 *
 * @param file Path of the Livescript source file.
 * @returns Diagnostics of the pipeline and the generated LLVM IR.
 */
export function compileFile(file: string): CompileResult {
  return compile(readFileSync(resolveInvocationPath(file), 'utf8'))
}
