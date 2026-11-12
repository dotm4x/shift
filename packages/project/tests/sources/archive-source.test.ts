import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { addArchivePackage, detectArchiveFormat } from '../../source/sources/archive-source.js'
import { PackageStore } from '../../source/store/package-store.js'

let directories: string[] = []

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'livescript-archive-'))
  directories.push(directory)

  return directory
}

afterEach(() => {
  for (const directory of directories) {
    rmSync(directory, { force: true, recursive: true })
  }

  directories = []
})

function tarHeader(name: string, size: number, typeFlag: string): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0)
  header.write('0000644\0', 100)
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
  header.write(typeFlag, 156)
  header.write('ustar\0', 257)
  header.write('00', 263)

  let checksum = 0

  for (const byte of header) {
    checksum += byte
  }

  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148)

  return header
}

function createTarBuffer(entries: readonly { name: string; data?: Buffer }[]): Buffer {
  const blocks: Buffer[] = []

  for (const entry of entries) {
    const data = entry.data ?? Buffer.alloc(0)
    blocks.push(tarHeader(entry.name, data.length, '0'))
    blocks.push(Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]))
  }

  blocks.push(Buffer.alloc(1024))

  return Buffer.concat(blocks)
}

describe('detectArchiveFormat', () => {
  it('detects supported formats', () => {
    expect(detectArchiveFormat('pkg.tar')).toBe('tar')
    expect(detectArchiveFormat('pkg.tar.gz')).toBe('tar.gz')
    expect(detectArchiveFormat('pkg.tgz')).toBe('tar.gz')
    expect(detectArchiveFormat('pkg.zip')).toBe('zip')
  })

  it('rejects unsupported formats', () => {
    expect(() => detectArchiveFormat('pkg.rar')).toThrow(/Unsupported archive format/)
  })
})

describe('addArchivePackage', () => {
  it('adds a package from an unwrapped tar archive', () => {
    const root = createTemporaryDirectory()
    const store = new PackageStore(join(root, 'store'))
    const archive = join(root, 'core.tar')
    const tar = createTarBuffer([
      {
        name: 'core/project.json',
        data: Buffer.from('{"name":"@fable/core","version":"1.0.0","type":"library"}'),
      },
      { name: 'core/index.ls', data: Buffer.from('export function hello() {}') },
    ])

    rmSync(archive, { force: true })
    writeFileSync(archive, tar)

    const stored = addArchivePackage(store, archive)

    expect(stored.name).toBe('@fable/core')
    expect(stored.version).toBe('1.0.0')
    expect(store.resolve('@fable/core')).toBeDefined()
  })

  it('rejects archives without a project.json', () => {
    const root = createTemporaryDirectory()
    const store = new PackageStore(join(root, 'store'))
    const archive = join(root, 'empty.tar')
    writeFileSync(archive, createTarBuffer([{ name: 'readme.txt', data: Buffer.from('hi') }]))

    expect(() => addArchivePackage(store, archive)).toThrow(/project\.json/)
  })
})
