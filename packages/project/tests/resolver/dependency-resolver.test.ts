import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { parseProjectManifest } from '../../source/manifest/project-manifest.js'
import {
  DependencyResolutionError,
  resolveDependencies,
} from '../../source/resolver/dependency-resolver.js'
import { PackageStore } from '../../source/store/package-store.js'

let directories: string[] = []

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'livescript-resolver-'))
  directories.push(directory)

  return directory
}

afterEach(() => {
  for (const directory of directories) {
    rmSync(directory, { force: true, recursive: true })
  }

  directories = []
})

function createLocalPackage(
  root: string,
  name: string,
  version: string,
  dependencies: { [key: string]: string } = {},
): string {
  const directory = join(root, name.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'project.json'),
    JSON.stringify({ name, version, type: 'library', dependencies }),
  )

  return directory
}

describe('resolveDependencies', () => {
  it('resolves direct dependencies', () => {
    const root = createTemporaryDirectory()
    const store = new PackageStore(join(root, 'store'))
    store.addLocalPackage(createLocalPackage(root, 'core', '1.0.0'))

    const manifest = parseProjectManifest(
      JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { core: '^1.0.0' } }),
    )
    const result = resolveDependencies(manifest, store)

    expect(result.resolved.size).toBe(1)
    expect(result.resolved.get('core@1.0.0')?.name).toBe('core')
    expect(result.lockfile.packages['core@1.0.0']?.source).toBe('local')
  })

  it('resolves transitive dependencies', () => {
    const root = createTemporaryDirectory()
    const store = new PackageStore(join(root, 'store'))
    store.addLocalPackage(createLocalPackage(root, 'networking', '1.0.0', { core: '^1.0.0' }))
    store.addLocalPackage(createLocalPackage(root, 'core', '1.0.0'))

    const manifest = parseProjectManifest(
      JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { networking: '^1.0.0' } }),
    )
    const result = resolveDependencies(manifest, store)

    expect(result.resolved.size).toBe(2)
  })

  it('includes development dependencies when requested', () => {
    const root = createTemporaryDirectory()
    const store = new PackageStore(join(root, 'store'))
    store.addLocalPackage(createLocalPackage(root, 'testing', '1.0.0'))

    const manifest = parseProjectManifest(
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        developmentDependencies: { testing: '^1.0.0' },
      }),
    )
    const withoutDevelopment = resolveDependencies(manifest, store)
    const withDevelopment = resolveDependencies(manifest, store, true)

    expect(withoutDevelopment.resolved.size).toBe(0)
    expect(withDevelopment.resolved.size).toBe(1)
  })

  it('throws for missing packages', () => {
    const root = createTemporaryDirectory()
    const store = new PackageStore(join(root, 'store'))
    const manifest = parseProjectManifest(
      JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { missing: '^1.0.0' } }),
    )

    expect(() => resolveDependencies(manifest, store)).toThrow(DependencyResolutionError)
  })

  it('detects circular dependencies', () => {
    const root = createTemporaryDirectory()
    const store = new PackageStore(join(root, 'store'))
    store.addLocalPackage(createLocalPackage(root, 'a', '1.0.0', { b: '^1.0.0' }))
    store.addLocalPackage(createLocalPackage(root, 'b', '1.0.0', { a: '^1.0.0' }))

    const manifest = parseProjectManifest(
      JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { a: '^1.0.0' } }),
    )

    expect(() => resolveDependencies(manifest, store)).toThrow(/Circular dependency/)
  })
})
