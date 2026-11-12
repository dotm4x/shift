import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import * as ts from 'typescript'

import { CompilerError, DiagnosticBag, Parser } from '@shift/compiler'

/** A name bound by an import declaration. */
export interface ImportedName {
  /** Bound name, such as `add`. */
  readonly name: string
  /** Syntax node of the binding, used to report errors at its location. */
  readonly node: ts.ImportSpecifier
}

/** An import declaration of a module. */
export interface ImportedModule {
  /** Import specifier, such as `@calculator/mathlib`. */
  readonly specifier: string
  /** Syntax node of the declaration, used to report errors at its location. */
  readonly declaration: ts.ImportDeclaration
  /** Names bound by the import declaration. */
  readonly names: readonly ImportedName[]
}

/** A module of the compilation graph. */
export interface ModuleNode {
  /** Absolute path of the module source file. */
  readonly path: string
  /** Import declarations of the module. */
  readonly imports: readonly ImportedModule[]
}

/**
 * Collects the import declarations of a module source.
 *
 * @param source Module source text.
 * @param fileName Path of the module source file, used to report errors.
 * @returns Import declarations in declaration order.
 */
export function parseImports(source: string, fileName: string): readonly ImportedModule[] {
  const sourceFile = new Parser({ fileName }).parse(source, new DiagnosticBag())
  const imports: ImportedModule[] = []

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }

    const specifier = statement.moduleSpecifier.text
    const bindings = statement.importClause?.namedBindings
    const names =
      bindings !== undefined && ts.isNamedImports(bindings)
        ? bindings.elements.map((element) => ({ name: element.name.text, node: element }))
        : []

    imports.push({ specifier, declaration: statement, names })
  }

  return imports
}

/**
 * Resolves an import specifier into a module source path.
 *
 * @param specifier Import specifier.
 * @param fromFile Path of the file that declares the import.
 * @param packages Installed packages mapped from package name to their base directory.
 * @returns Absolute path of the imported module source.
 */
export function resolveModulePath(
  specifier: string,
  fromFile: string,
  packages: ReadonlyMap<string, string>,
  node: ts.ImportDeclaration,
): string {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const directory = dirname(fromFile)

    return resolve(directory, `${specifier}.shift`)
  }

  let bestName: string | undefined

  for (const name of packages.keys()) {
    if (specifier === name || specifier.startsWith(`${name}/`)) {
      if (bestName === undefined || name.length > bestName.length) {
        bestName = name
      }
    }
  }

  if (bestName === undefined || packages.get(bestName) === undefined) {
    throw new CompilerError(
      'unknown-import',
      `Cannot resolve import '${specifier}'.`,
      node,
      'Install the package into the global store, or use a relative specifier for local modules.',
    )
  }

  const base = packages.get(bestName)

  if (base === undefined) {
    throw new CompilerError(
      'unknown-import',
      `Cannot resolve import '${specifier}'.`,
      node,
      'Install the package into the global store, or use a relative specifier for local modules.',
    )
  }

  const manifestPath = join(base, 'project.json')

  if (!existsSync(manifestPath)) {
    throw new CompilerError(
      'unknown-import',
      `Package '${bestName}' has no project.json in the store.`,
      node,
      'Add the package to the store with `shift package add-local`.',
    )
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { entry?: string }

  return join(base, manifest.entry ?? 'src/index.shift')
}

/**
 * Collects the module graph reachable from an entry file, dependencies first.
 *
 * @param entryPath Absolute path of the entry module.
 * @param packages Installed packages mapped from package name to their base directory.
 * @returns Modules in dependency-first order.
 */
export function collectModuleGraph(
  entryPath: string,
  packages: ReadonlyMap<string, string>,
): readonly ModuleNode[] {
  const ordered: ModuleNode[] = []
  const visited = new Set<string>()

  function visit(path: string, importer?: ImportedModule): void {
    const normalized = resolve(path)

    if (visited.has(normalized)) {
      return
    }

    visited.add(normalized)

    if (!existsSync(normalized)) {
      throw new CompilerError(
        'unknown-import',
        `Module '${normalized}' does not exist.`,
        importer?.declaration,
        'Check the specifier spelling, or create the module file.',
      )
    }

    const source = readFileSync(normalized, 'utf8')
    const imports = parseImports(source, normalized)

    for (const importedModule of imports) {
      visit(
        resolveModulePath(
          importedModule.specifier,
          normalized,
          packages,
          importedModule.declaration,
        ),
        importedModule,
      )
    }

    ordered.push({ path: normalized, imports })
  }

  visit(entryPath)

  return ordered
}
