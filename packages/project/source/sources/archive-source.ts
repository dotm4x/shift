import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

import type { PackageStore, StoredPackage } from '../store/package-store.js'

import { readTar } from './tar.js'
import { readZip } from './zip.js'

/** Maximum total uncompressed size of an archive, guarding against archive bombs. */
const maximumTotalSize = 512 * 1024 * 1024

/** Maximum number of entries in an archive. */
const maximumEntryCount = 100_000

/** Supported archive formats. */
export type ArchiveFormat = 'tar' | 'tar.gz' | 'zip'

/**
 * Detects the format of an archive by its extension.
 *
 * @param path Archive path.
 * @returns The detected format.
 * @throws When the format is not supported.
 */
export function detectArchiveFormat(path: string): ArchiveFormat {
  const lowered = path.toLowerCase()

  if (lowered.endsWith('.tar.gz') || lowered.endsWith('.tgz')) {
    return 'tar.gz'
  }

  if (lowered.endsWith('.tar')) {
    return 'tar'
  }

  if (lowered.endsWith('.zip')) {
    return 'zip'
  }

  throw new Error(`Unsupported archive format: '${path}'.`)
}

/**
 * Validates an entry path against path traversal attacks.
 *
 * @param name Entry path.
 * @throws When the path escapes the extraction directory.
 */
function validateEntryPath(name: string): void {
  if (name === '') {
    return
  }

  const normalized = resolve('/', name)

  if (name.startsWith('/') || name.includes('..') || normalized.startsWith('/..')) {
    throw new Error(`Unsafe archive entry path: '${name}'.`)
  }
}

/**
 * Extracts archive entries into a directory, safely.
 *
 * @param entries Archive entries.
 * @param directory Destination directory.
 */
function extractEntries(
  entries: readonly { name: string; type: 'file' | 'directory'; data: Buffer }[],
  directory: string,
): void {
  let totalSize = 0

  if (entries.length > maximumEntryCount) {
    throw new Error('Archive contains too many entries.')
  }

  for (const entry of entries) {
    validateEntryPath(entry.name)

    if (entry.name === '') {
      continue
    }

    totalSize += entry.data.length

    if (totalSize > maximumTotalSize) {
      throw new Error('Archive exceeds the maximum uncompressed size.')
    }

    const target = join(directory, entry.name)

    if (entry.type === 'directory') {
      mkdirSync(target, { recursive: true })
      continue
    }

    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, entry.data)
  }
}

/**
 * Adds a package from an archive file to the store.
 *
 * @param store Package store.
 * @param archivePath Path to the `.tar`, `.tar.gz`, `.tgz`, or `.zip` archive.
 * @returns Metadata of the stored package.
 */
export function addArchivePackage(store: PackageStore, archivePath: string): StoredPackage {
  const format = detectArchiveFormat(archivePath)
  let buffer = readFileSync(archivePath)

  if (format === 'tar.gz') {
    buffer = gunzipSync(buffer)
  }

  const entries = format === 'zip' ? readZip(buffer) : readTar(buffer)
  const directory = mkdtempSync(join(tmpdir(), 'shift-archive-'))

  try {
    extractEntries(entries, directory)
    const root = findPackageRoot(directory)

    return store.addLocalPackage(root)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

/**
 * Finds the directory that contains `project.json`, unwrapping a single top-level directory.
 *
 * @param directory Extraction directory.
 * @returns The package root directory.
 */
function findPackageRoot(directory: string): string {
  if (existsSync(join(directory, 'project.json'))) {
    return directory
  }

  const children = readdirSync(directory, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory(),
  )
  const child = children[0]

  if (child !== undefined) {
    const nested = join(directory, child.name)

    if (existsSync(join(nested, 'project.json'))) {
      return nested
    }
  }

  throw new Error('The archive does not contain a project.json at its root.')
}
