import { readFileSync } from 'node:fs'

import type * as ts from 'typescript'

import {
  Analyzer,
  CompilerError,
  DiagnosticBag,
  type FunctionSignature,
  Generator,
  Linter,
  ModuleResolver,
  Parser,
} from '@livescript/compiler'

import { renderDiagnostic } from './diagnostics.js'
import { collectModuleGraph, type ModuleNode, resolveModulePath } from './modules.js'
import { resolveInvocationPath } from './paths.js'

/** Result of running the compiler pipeline over Livescript source text. */
export interface CompileResult {
  readonly diagnostics: DiagnosticBag
  readonly ir: string
  /** Module resolver configured with the project's installed packages. */
  readonly resolver: ModuleResolver
}

/** A compiled module of the compilation graph. */
export interface CompiledModule {
  /** Absolute path of the module source file. */
  readonly path: string
  /** Generated LLVM IR text. */
  readonly ir: string
}

/** Options of the compiler pipeline. */
export interface CompileOptions {
  /** Name of the source file, used to report diagnostics. Defaults to `source.ls`. */
  readonly fileName?: string | undefined
  /** Names available in the global scope without being declared. */
  readonly globals?: readonly string[] | undefined
  /** Installed packages mapped from package name to their base directory in the store. */
  readonly packages?: ReadonlyMap<string, string> | undefined
  /** Signatures of functions defined in other modules and linked at build time. */
  readonly externalFunctions?: ReadonlyMap<string, FunctionSignature> | undefined
  /** Whether to generate the entry function that runs top-level statements. Defaults to true. */
  readonly generateEntry?: boolean | undefined
}

/**
 * Runs the compiler pipeline over Livescript source text.
 *
 * @param source Livescript source text.
 * @param options Pipeline options.
 * @returns Diagnostics of the pipeline, the generated LLVM IR, which is empty when the
 * pipeline reports errors, and the module resolver configured with the given packages.
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const diagnostics = new DiagnosticBag()
  const parserOptions = options.fileName === undefined ? {} : { fileName: options.fileName }
  const sourceFile = new Parser(parserOptions).parse(source, diagnostics)

  new Linter().lint(sourceFile, diagnostics)
  new Analyzer({ globals: options.globals }).analyze(sourceFile, diagnostics)

  const generatorOptions: {
    globals?: readonly string[]
    externalFunctions?: ReadonlyMap<string, FunctionSignature>
    generateEntry?: boolean
  } = {}

  if (options.globals !== undefined) {
    generatorOptions.globals = options.globals
  }

  if (options.externalFunctions !== undefined) {
    generatorOptions.externalFunctions = options.externalFunctions
  }

  if (options.generateEntry !== undefined) {
    generatorOptions.generateEntry = options.generateEntry
  }

  const resolverOptions: { packages?: ReadonlyMap<string, string> } = {}

  if (options.packages !== undefined) {
    resolverOptions.packages = options.packages
  }

  const resolver = new ModuleResolver(resolverOptions)

  if (diagnostics.hasErrors) {
    return { diagnostics, ir: '', resolver }
  }

  return {
    diagnostics,
    ir: new Generator().generate(sourceFile, generatorOptions),
    resolver,
  }
}

/**
 * Reads a Livescript file and runs the compiler pipeline over it.
 *
 * @param file Path of the Livescript source file.
 * @param options Pipeline options.
 * @returns Diagnostics of the pipeline and the generated LLVM IR.
 */
export function compileFile(file: string, options: CompileOptions = {}): CompileResult {
  const path = resolveInvocationPath(file)

  return compile(readFileSync(path, 'utf8'), { ...options, fileName: path })
}

/**
 * Compiles every module of a compilation graph, dependencies first.
 *
 * @param graph Modules in dependency-first order.
 * @param packages Installed packages mapped from package name to their base directory.
 * @returns The compiled modules in the same order as the graph.
 */
export function compileModuleGraph(
  graph: readonly ModuleNode[],
  packages: ReadonlyMap<string, string>,
): readonly CompiledModule[] {
  const sources = new Map<string, ts.SourceFile>()

  for (const node of graph) {
    sources.set(
      node.path,
      new Parser({ fileName: node.path }).parse(
        readFileSync(node.path, 'utf8'),
        new DiagnosticBag(),
      ),
    )
  }

  const compiled: CompiledModule[] = []

  for (const node of graph) {
    const sourceFile = sources.get(node.path)

    if (sourceFile === undefined) {
      throw new Error(`Module '${node.path}' was not parsed.`)
    }

    const externalFunctions = new Map<string, FunctionSignature>()
    const globals: string[] = []

    for (const importedModule of node.imports) {
      const importedPath = resolveModulePath(
        importedModule.specifier,
        node.path,
        packages,
        importedModule.declaration,
      )
      const imported = sources.get(importedPath)

      if (imported === undefined) {
        throw new Error(`Module '${importedPath}' was not parsed.`)
      }

      const exported = new Generator().signaturesOf(imported)

      for (const importedName of importedModule.names) {
        const signature = exported.get(importedName.name)

        if (signature === undefined) {
          throw new CompilerError(
            'no-export',
            `Module '${importedModule.specifier}' does not export '${importedName.name}'.`,
            importedName.node,
            `Add 'export' to its declaration in '${importedModule.specifier}', or import a name it exports.`,
          )
        }

        externalFunctions.set(importedName.name, signature)
        globals.push(importedName.name)
      }
    }

    const result = compile(readFileSync(node.path, 'utf8'), {
      fileName: node.path,
      globals,
      externalFunctions,
      generateEntry: node === graph.at(-1),
    })

    if (result.diagnostics.hasErrors) {
      const rendered = result.diagnostics.all
        .map((diagnostic) => renderDiagnostic(node.path, diagnostic))
        .join('\n')

      throw new Error(rendered)
    }

    compiled.push({ path: node.path, ir: result.ir })
  }

  return compiled
}

/**
 * Collects and compiles the module graph reachable from an entry file.
 *
 * @param entryPath Absolute path of the entry module.
 * @param packages Installed packages mapped from package name to their base directory.
 * @returns The compiled modules in dependency-first order.
 */
export function compileProject(
  entryPath: string,
  packages: ReadonlyMap<string, string>,
): readonly CompiledModule[] {
  return compileModuleGraph(collectModuleGraph(entryPath, packages), packages)
}
