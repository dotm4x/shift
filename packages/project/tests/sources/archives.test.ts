import { gunzipSync, gzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { readTar } from '../../source/sources/tar.js'
import { readZip } from '../../source/sources/zip.js'

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

function createTar(entries: readonly { name: string; data?: Buffer }[]): Buffer {
  const blocks: Buffer[] = []

  for (const entry of entries) {
    const data = entry.data ?? Buffer.alloc(0)
    blocks.push(tarHeader(entry.name, data.length, '0'))
    blocks.push(Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]))
  }

  blocks.push(Buffer.alloc(1024))

  return Buffer.concat(blocks)
}

describe('readTar', () => {
  it('parses file entries', () => {
    const buffer = createTar([{ name: 'project.json', data: Buffer.from('{"name":"a"}') }])
    const entries = readTar(buffer)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe('project.json')
    expect(entries[0]?.type).toBe('file')
    expect(entries[0]?.data.toString()).toBe('{"name":"a"}')
  })

  it('stops at the trailing zero blocks', () => {
    const buffer = createTar([])
    expect(readTar(buffer)).toHaveLength(0)
  })
})

function zipEntry(name: string, data: Buffer): { local: Buffer; central: Buffer } {
  const local = Buffer.alloc(30 + name.length + data.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)
  local.write(name, 30)
  data.copy(local, 30 + name.length)

  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(0, 10)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt16LE(0, 30)
  central.writeUInt16LE(0, 32)
  central.writeUInt32LE(0, 42)
  central.write(name, 46)

  return { local, central }
}

function createZip(entries: readonly { name: string; data?: Buffer }[]): Buffer {
  const parts: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const data = entry.data ?? Buffer.alloc(0)
    const { local, central } = zipEntry(entry.name, data)
    central.writeUInt32LE(offset, 42)
    parts.push(local)
    centrals.push(central)
    offset += local.length
  }

  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...parts, centralDirectory, end])
}

describe('readZip', () => {
  it('parses stored entries', () => {
    const buffer = createZip([{ name: 'project.json', data: Buffer.from('{"name":"a"}') }])
    const entries = readZip(buffer)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe('project.json')
    expect(entries[0]?.data.toString()).toBe('{"name":"a"}')
  })

  it('treats names ending with slash as directories', () => {
    const buffer = createZip([{ name: 'lib/' }])
    const entries = readZip(buffer)

    expect(entries[0]?.type).toBe('directory')
  })

  it('rejects archives without an end of central directory', () => {
    expect(() => readZip(Buffer.from('not a zip'))).toThrow(/end of central directory/)
  })
})

describe('gzip round trip', () => {
  it('gunzip reverses gzip', () => {
    const original = Buffer.from('tar content')
    expect(gunzipSync(gzipSync(original)).toString()).toBe('tar content')
  })
})
