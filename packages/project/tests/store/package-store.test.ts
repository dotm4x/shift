import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { PackageStore } from '../../source/store/package-store.js'

let directories: string[] = []

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'livescript-store-'))
  directories.push(directory)

  return directory
}

afterEach(() => {
  for (const directory of directories) {
    rmSync(directory, { force: true, recursive: true })
  }

  directories = []
})

function createLocalPackage(root: string, name: string, version: string, content: string): string {
  const directory = join(root, name.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'project.json'), JSON.stringify({ name, version, type: 'library' }))
  writeFileSync(join(directory, 'index.ls'), content)

  return directory
}

describe('PackageStore', () => {
  it('adds a local package and deduplicates identical content', () => {
    const root = createTemporaryDirectory()
    const store = new PackageStore(join(root, 'store'))
    const source = createLocalPackage(root, '@fable/core', '1.0.0', 'export function hello() {}')

    const first = store.addLocalPackage(source)
    const second = store.addLocalPackage(source)

    expect(first.name).toBe('@fable/core')
    expect(first.version).toBe('1.0.0')
    expect(second.integrity).toBe(first.integrity)
    expect(store.list()).toHaveLength(1)
  })

  it('resolves a package by name', () => {
    const root = createTemporaryDirectory()
    const store = new PackageStore(join(root, 'store'))
    const source = createLocalPackage(root, '@fable/core', '1.0.0', 'content')
    store.addLocalPackage(source)

    const resolved = store.resolve('@fable/core')

    expect(resolved?.name).toBe('@fable/core')
    expect(resolved?.version).toBe('1.0.0')
  })

  it('resolves the highest version when no constraint is given', () => {
    const root = createTemporaryDirectory()
    const store = new PackageStore(join(root, 'store'))
    store.addLocalPackage(createLocalPackage(root, 'core', '1.0.0', 'one'))
    store.addLocalPackage(createLocalPackage(root, 'core', '2.0.0', 'two'))

    expect(store.resolve('core')?.version).toBe('2.0.0')
  })

  it('returns undefined for unknown packages', () => {
    const root = createTemporaryDirectory()
    const store = new PackageStore(join(root, 'store'))

    expect(store.resolve('missing')).toBeUndefined()
  })

  it('removes a package by integrity', () => {
    const root = createTemporaryDirectory()
    const store = new PackageStore(join(root, 'store'))
    const stored = store.addLocalPackage(createLocalPackage(root, 'core', '1.0.0', 'content'))

    store.remove(stored.integrity)

    expect(store.list()).toHaveLength(0)
  })

  it('cleans the store', () => {
    const root = createTemporaryDirectory()
    const store = new PackageStore(join(root, 'store'))
    store.addLocalPackage(createLocalPackage(root, 'core', '1.0.0', 'content'))

    store.clean()

    expect(store.list()).toHaveLength(0)
  })

  it('rejects a directory without project.json', () => {
    const root = createTemporaryDirectory()
    const store = new PackageStore(join(root, 'store'))

    expect(() => store.addLocalPackage(root)).toThrow(/project\.json/)
  })
})
