import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  globToRegExp,
  PackageStore,
  parseProjectManifest,
  type ProjectManifest,
  serializeProjectManifest,
} from '@livescript/project'

import { resolveInvocationPath } from './paths.js'

/** Finds the nearest directory containing `project.json` starting from `start`. */
export function findProjectRoot(start: string = process.cwd()): string | undefined {
  let current = resolve(start)
  let parent = resolve(current, '..')

  while (!existsSync(join(current, 'project.json')) && parent !== current) {
    current = parent
    parent = resolve(current, '..')
  }

  return existsSync(join(current, 'project.json')) ? current : undefined
}

/** Reads the project manifest from a directory. */
export function readManifestFromDirectory(directory: string): ProjectManifest {
  return parseProjectManifest(readFileSync(join(directory, 'project.json'), 'utf8'))
}

/** Writes a project manifest to a directory. */
export function writeManifestToDirectory(directory: string, manifest: ProjectManifest): void {
  writeFileSync(join(directory, 'project.json'), serializeProjectManifest(manifest))
}

/** Creates a package store using the default location. */
export function createDefaultStore(): PackageStore {
  return new PackageStore()
}

/** Resolves a path relative to the invocation directory. */
export function resolveProjectPath(path: string): string {
  return resolveInvocationPath(path)
}

/**
 * Builds the package map used by the compiler module resolver, from the project's dependencies
 * that are installed in the global store.
 *
 * @param manifest Project manifest.
 * @returns A map from package name to its base directory in the store.
 */
export function resolveInstalledPackages(manifest: ProjectManifest): ReadonlyMap<string, string> {
  const store = new PackageStore()
  const packages = new Map<string, string>()

  for (const name of Object.keys({
    ...(manifest.dependencies ?? {}),
    ...(manifest.developmentDependencies ?? {}),
  })) {
    const stored = store.resolve(name)

    if (stored !== undefined) {
      packages.set(name, stored.path)
    }
  }

  return packages
}

/**
 * Returns the entry source file of a project, relative to the project root.
 *
 * @param manifest Project manifest.
 * @returns The entry path, defaulting by project type.
 */
export function entryOf(manifest: ProjectManifest): string {
  return manifest.entry ?? (manifest.type === 'executable' ? 'src/main.ls' : 'src/index.ls')
}

/**
 * Resolves the base directory of a command, honoring a `--path` option.
 *
 * @param pathOption Value of the `--path` option, when provided.
 * @returns Absolute base directory.
 */
export function resolveBaseDirectory(pathOption?: string): string {
  return resolveInvocationPath(pathOption ?? '.')
}

/**
 * Returns whether a project name matches any of the given filters.
 *
 * A filter matches by exact name or by glob pattern with `*` wildcards that do not cross path
 * separators, so `@calculator/*` matches `@calculator/calc` but not `@calculator/calc/extra`.
 *
 * @param name Project name.
 * @param filters Filters to match against; every project matches when omitted or empty.
 * @returns Whether the name matches.
 */
export function matchesFilters(name: string, filters?: readonly string[]): boolean {
  if (filters === undefined || filters.length === 0) {
    return true
  }

  return filters.some((filter) => filter === name || globToRegExp(filter).test(name))
}

/**
 * Returns the output path of a project build, relative to the project root.
 *
 * @param manifest Project manifest.
 * @param projectRoot Absolute project root directory.
 * @returns The executable path inside the configured output directory.
 */
export function outputOf(manifest: ProjectManifest, projectRoot: string): string {
  const name = manifest.name.split('/').at(-1) ?? manifest.name

  return join(projectRoot, manifest.build?.output ?? 'build', name)
}
