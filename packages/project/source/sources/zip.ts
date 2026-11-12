import { inflateRawSync } from 'node:zlib'

/** A single entry of a zip archive. */
export interface ZipEntry {
  /** Entry path, without a leading slash. */
  readonly name: string
  /** Entry kind. */
  readonly type: 'file' | 'directory'
  /** File contents, empty for directories. */
  readonly data: Buffer
}

const centralHeaderSignature = 0x02014b50
const endOfCentralDirectorySignature = 0x06054b50

function readUint16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset)
}

function readUint32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset)
}

/**
 * Parses a zip archive (stored and deflate methods) into entries.
 *
 * @param buffer Archive contents.
 * @returns The archive entries in order.
 * @throws When the archive is malformed or uses an unsupported compression method.
 */
export function readZip(buffer: Buffer): readonly ZipEntry[] {
  const endOffset = findEndOfCentralDirectory(buffer)

  if (endOffset === undefined) {
    throw new Error('Invalid zip archive: end of central directory not found.')
  }

  const entryCount = readUint16(buffer, endOffset + 10)
  let offset = readUint32(buffer, endOffset + 16)
  const entries: ZipEntry[] = []

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(buffer, offset) !== centralHeaderSignature) {
      throw new Error('Invalid zip archive: corrupted central directory.')
    }

    const compressionMethod = readUint16(buffer, offset + 10)
    const compressedSize = readUint32(buffer, offset + 20)
    const nameLength = readUint16(buffer, offset + 28)
    const extraLength = readUint16(buffer, offset + 30)
    const commentLength = readUint16(buffer, offset + 32)
    const localHeaderOffset = readUint32(buffer, offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')

    const localNameLength = readUint16(buffer, localHeaderOffset + 26)
    const localExtraLength = readUint16(buffer, localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)

    const directory = name.endsWith('/')
    let data: Buffer

    if (directory) {
      data = Buffer.alloc(0)
    } else if (compressionMethod === 0) {
      data = Buffer.from(compressed)
    } else if (compressionMethod === 8) {
      data = inflateRawSync(compressed)
    } else {
      throw new Error(
        `Unsupported zip compression method ${String(compressionMethod)} for entry '${name}'.`,
      )
    }

    entries.push({ name: name.replace(/\/$/, ''), type: directory ? 'directory' : 'file', data })
    offset += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

function findEndOfCentralDirectory(buffer: Buffer): number | undefined {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (readUint32(buffer, offset) === endOfCentralDirectorySignature) {
      return offset
    }
  }

  return undefined
}
