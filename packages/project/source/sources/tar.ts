/** A single entry of a tar archive. */
export interface TarEntry {
  /** Entry path, without a leading slash. */
  readonly name: string
  /** Entry kind. */
  readonly type: 'file' | 'directory'
  /** File contents, empty for directories. */
  readonly data: Buffer
}

const blockSize = 512

function readOctal(buffer: Buffer, offset: number, length: number): number {
  const text = buffer
    .subarray(offset, offset + length)
    .toString('utf8')
    .replace(/[\0 ]+$/g, '')
    .trim()

  if (text === '') {
    return 0
  }

  return Number.parseInt(text, 8)
}

function readString(buffer: Buffer, offset: number, length: number): string {
  const text = buffer.subarray(offset, offset + length).toString('utf8')
  const terminator = text.indexOf('\0')

  return terminator === -1 ? text : text.slice(0, terminator)
}

/**
 * Parses a tar archive (ustar and GNU extensions) into entries.
 *
 * @param buffer Archive contents.
 * @returns The archive entries in order.
 * @throws When the archive is malformed.
 */
export function readTar(buffer: Buffer): readonly TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  let pendingLongName: string | undefined

  while (offset + blockSize <= buffer.length) {
    const header = buffer.subarray(offset, offset + blockSize)

    if (header.every((byte) => byte === 0)) {
      break
    }

    const name = readString(header, 0, 100)
    const size = readOctal(header, 124, 12)
    const typeFlag = header[156] ?? 0
    const prefix = readString(header, 345, 155)
    const dataStart = offset + blockSize
    const data = buffer.subarray(dataStart, dataStart + size)

    if (typeFlag === 0x4c) {
      // GNU long name ('L'): the next entry uses this name.
      pendingLongName = data.toString('utf8').replace(/\0+$/g, '')
    } else if (typeFlag === 0x78) {
      // pax extended header: skipped.
    } else if (typeFlag === 0x30 || typeFlag === 0 || typeFlag === 0x35) {
      const directory = typeFlag === 0x35
      const fullName = pendingLongName ?? (prefix === '' ? name : `${prefix}/${name}`)

      entries.push({
        name: fullName.replace(/^\.\//, '').replace(/\/$/, ''),
        type: directory ? 'directory' : 'file',
        data: directory ? Buffer.alloc(0) : Buffer.from(data),
      })

      pendingLongName = undefined
    } else {
      pendingLongName = undefined
    }

    offset = dataStart + Math.ceil(size / blockSize) * blockSize
  }

  return entries
}
