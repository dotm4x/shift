import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** Current lockfile schema version. */
export const currentLockfileVersion = 1

/** A single resolved package entry in the lockfile. */
export interface LockfilePackage {
  /** Package name. */
  readonly name: string
  /** Resolved version. */
  readonly version: string
  /** Integrity hash (sha256 hex). */
  readonly integrity: string
  /** Source identifier, such as `local` or `file`. */
  readonly source: string
  /** Resolved dependencies of this package. */
  readonly dependencies?: Readonly<{ [key: string]: string }>
  /** Target platform, when applicable. */
  readonly platform?: string
}

/** A reproducible lockfile. */
export interface Lockfile {
  /** Schema version. */
  readonly lockfileVersion: number
  /** Resolved packages keyed by `name@version`. */
  readonly packages: Readonly<{ [key: string]: LockfilePackage }>
}

/** Error thrown when a lockfile is invalid. */
export class LockfileError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'LockfileError'
  }
}

/**
 * Parses and validates a lockfile from JSON text.
 *
 * @param text JSON text.
 * @returns The validated lockfile.
 */
export function parseLockfile(text: string): Lockfile {
  let raw: unknown

  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new LockfileError(
      `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new LockfileError('Lockfile must be a JSON object.')
  }

  const record = raw as { [key: string]: unknown }

  if (typeof record.lockfileVersion !== 'number') {
    throw new LockfileError("'lockfileVersion' must be a number.")
  }

  if (
    typeof record.packages !== 'object' ||
    record.packages === null ||
    Array.isArray(record.packages)
  ) {
    throw new LockfileError("'packages' must be an object.")
  }

  const packages: { [key: string]: LockfilePackage } = {}

  for (const [key, value] of Object.entries(record.packages as { [key: string]: unknown })) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new LockfileError(`Package entry '${key}' must be an object.`)
    }

    const entry = value as { [key: string]: unknown }

    if (
      typeof entry.name !== 'string' ||
      typeof entry.version !== 'string' ||
      typeof entry.integrity !== 'string' ||
      typeof entry.source !== 'string'
    ) {
      throw new LockfileError(`Package entry '${key}' is missing required fields.`)
    }

    const entryPackage: LockfilePackage = {
      name: entry.name,
      version: entry.version,
      integrity: entry.integrity,
      source: entry.source,
    }

    if (isStringRecord(entry.dependencies)) {
      ;(entryPackage as { dependencies?: Readonly<{ [key: string]: string }> }).dependencies =
        entry.dependencies
    }

    if (typeof entry.platform === 'string') {
      ;(entryPackage as { platform?: string }).platform = entry.platform
    }

    packages[key] = entryPackage
  }

  return { lockfileVersion: record.lockfileVersion, packages }
}

function isStringRecord(value: unknown): value is Readonly<{ [key: string]: string }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  )
}

/**
 * Reads a lockfile from disk.
 *
 * @param path Absolute path.
 * @returns The lockfile, or `undefined` when the file does not exist.
 */
export function readLockfile(path: string): Lockfile | undefined {
  if (!existsSync(path)) {
    return undefined
  }

  return parseLockfile(readFileSync(path, 'utf8'))
}

/**
 * Writes a lockfile to disk.
 *
 * @param path Absolute path.
 * @param lockfile Lockfile to write.
 */
export function writeLockfile(path: string, lockfile: Lockfile): void {
  const sortedPackages: { [key: string]: LockfilePackage } = {}

  for (const key of Object.keys(lockfile.packages).sort()) {
    const entry = lockfile.packages[key]

    if (entry !== undefined) {
      sortedPackages[key] = entry
    }
  }

  const output: Lockfile = { lockfileVersion: lockfile.lockfileVersion, packages: sortedPackages }
  writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`)
}

/**
 * Creates an empty lockfile.
 */
export function createEmptyLockfile(): Lockfile {
  return { lockfileVersion: currentLockfileVersion, packages: {} }
}
