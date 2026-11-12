import { readFileSync } from 'node:fs'

import type { Lockfile, LockfilePackage } from '../lockfile/lockfile.js'
import type { ProjectManifest } from '../manifest/project-manifest.js'
import type { PackageStore } from '../store/package-store.js'

import { satisfies } from './semver.js'

/** A resolved dependency entry. */
export interface ResolvedDependency {
  readonly name: string
  readonly version: string
  readonly integrity: string
  readonly path: string
  readonly dependencies: Readonly<{ [key: string]: string }>
}

/** Result of dependency resolution. */
export interface ResolutionResult {
  readonly resolved: ReadonlyMap<string, ResolvedDependency>
  readonly lockfile: Lockfile
}

/** Error thrown when resolution fails. */
export class DependencyResolutionError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'DependencyResolutionError'
  }
}

/**
 * Resolves the dependency graph of a project against a package store.
 *
 * @param manifest Project manifest.
 * @param store Package store.
 * @param includeDevelopment Whether to include development dependencies.
 * @returns Resolution result with resolved packages and lockfile.
 */
export function resolveDependencies(
  manifest: ProjectManifest,
  store: PackageStore,
  includeDevelopment: boolean = false,
): ResolutionResult {
  const resolved = new Map<string, ResolvedDependency>()
  const visiting = new Set<string>()

  const dependencies: { [key: string]: string } = { ...(manifest.dependencies ?? {}) }

  if (includeDevelopment) {
    Object.assign(dependencies, manifest.developmentDependencies ?? {})
  }

  function resolvePackage(name: string, constraint: string, path: string[]): void {
    if (visiting.has(name)) {
      throw new DependencyResolutionError(
        `Circular dependency detected: ${[...path, name].join(' -> ')}.`,
      )
    }

    const stored = store.resolve(name, constraint)

    if (stored === undefined) {
      throw new DependencyResolutionError(
        `Package '${name}' (${constraint}) is not available in the store.`,
      )
    }

    const resolvedKey = `${name}@${stored.version}`

    if (resolved.has(resolvedKey)) {
      return
    }

    if (!satisfies(stored.version, constraint)) {
      throw new DependencyResolutionError(
        `Resolved version ${stored.version} of '${name}' does not satisfy '${constraint}'.`,
      )
    }

    visiting.add(name)

    let childDependencies: { [key: string]: string }

    try {
      const manifestPath = `${stored.path}/project.json`

      // Read child manifest if present.
      try {
        const text = readFileSync(manifestPath, 'utf8')
        const parsed = JSON.parse(text) as { dependencies?: { [key: string]: string } }
        childDependencies = parsed.dependencies ?? {}
      } catch {
        childDependencies = {}
      }

      for (const [childName, childConstraint] of Object.entries(childDependencies)) {
        resolvePackage(childName, childConstraint, [...path, name])
      }
    } finally {
      visiting.delete(name)
    }

    resolved.set(resolvedKey, {
      name,
      version: stored.version,
      integrity: stored.integrity,
      path: stored.path,
      dependencies: childDependencies,
    })
  }

  for (const [name, constraint] of Object.entries(dependencies)) {
    resolvePackage(name, constraint, [])
  }

  const lockfilePackages: { [key: string]: LockfilePackage } = {}

  for (const [key, entry] of resolved) {
    lockfilePackages[key] = {
      name: entry.name,
      version: entry.version,
      integrity: entry.integrity,
      source: 'local',
      dependencies: entry.dependencies,
    }
  }

  return {
    resolved,
    lockfile: { lockfileVersion: 1, packages: lockfilePackages },
  }
}
