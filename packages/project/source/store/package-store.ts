import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

/** Metadata of a package installed in the store. */
export interface StoredPackage {
  /** Package name. */
  readonly name: string
  /** Package version. */
  readonly version: string
  /** Content hash of the package. */
  readonly integrity: string
  /** Absolute path to the extracted package contents in the store. */
  readonly path: string
}

/** Index entry mapping a package to its content hash. */
interface StoreIndexEntry {
  readonly name: string
  readonly version: string
  readonly integrity: string
}

interface StoreIndex {
  readonly packages: readonly StoreIndexEntry[]
}

/** A content-addressable global package store. */
export class PackageStore {
  private readonly _root: string

  public constructor(root?: string) {
    this._root = root ?? getDefaultStoreRoot()
  }

  /** Absolute root directory of the store. */
  public get root(): string {
    return this._root
  }

  /** Directory containing extracted package contents by hash. */
  public get storeDirectory(): string {
    return join(this._root, 'store')
  }

  /** Path to the store index file. */
  public get indexPath(): string {
    return join(this._root, 'index.json')
  }

  /** Ensures the store directories exist. */
  public initialize(): void {
    mkdirSync(this.storeDirectory, { recursive: true })
  }

  /** Lists all packages currently in the store. */
  public list(): readonly StoredPackage[] {
    const index = this.readIndex()

    return index.packages.map((entry) => ({
      name: entry.name,
      version: entry.version,
      integrity: entry.integrity,
      path: join(this.storeDirectory, entry.integrity),
    }))
  }

  /**
   * Adds a local package directory to the store.
   *
   * @param sourcePath Absolute path to the package directory (must contain `project.json`).
   * @returns Metadata of the stored package.
   */
  public addLocalPackage(sourcePath: string): StoredPackage {
    this.initialize()

    const manifestPath = join(sourcePath, 'project.json')

    if (!existsSync(manifestPath)) {
      throw new Error(`No project.json found in '${sourcePath}'.`)
    }

    const manifestText = readFileSync(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestText) as { name: string; version: string }

    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error('Invalid manifest: missing name or version.')
    }

    const integrity = computeDirectoryHash(sourcePath)
    const targetPath = join(this.storeDirectory, integrity)

    if (!existsSync(targetPath)) {
      cpSync(sourcePath, targetPath, { recursive: true })
    }

    const entry: StoreIndexEntry = { name: manifest.name, version: manifest.version, integrity }
    const index = this.readIndex()

    if (!index.packages.some((item) => item.integrity === integrity)) {
      index.packages.push(entry)
      this.writeIndex(index)
    } else if (
      !index.packages.some(
        (item) => item.name === manifest.name && item.version === manifest.version,
      )
    ) {
      index.packages.push(entry)
      this.writeIndex(index)
    }

    return { name: manifest.name, version: manifest.version, integrity, path: targetPath }
  }

  /**
   * Resolves a package by name and version constraint.
   *
   * @param name Package name.
   * @param constraint Version constraint (exact match in MVP).
   * @returns The stored package, or `undefined` when not found.
   */
  public resolve(name: string, constraint?: string): StoredPackage | undefined {
    const index = this.readIndex()
    const candidates = index.packages.filter((entry) => entry.name === name)

    if (candidates.length === 0) {
      return undefined
    }

    const sorted = [...candidates].sort(compareVersionsDescending)
    let chosen = sorted[0]

    if (constraint !== undefined && constraint !== '' && constraint !== '*') {
      const wanted = constraint.replace(/^[~^]/, '')
      const match = sorted.find((entry) => entry.version === wanted)

      if (match !== undefined) {
        chosen = match
      }
    }

    if (chosen === undefined) {
      return undefined
    }

    return {
      name: chosen.name,
      version: chosen.version,
      integrity: chosen.integrity,
      path: join(this.storeDirectory, chosen.integrity),
    }
  }

  /**
   * Removes a package from the store by integrity hash.
   *
   * @param integrity Content hash of the package.
   */
  public remove(integrity: string): void {
    const targetPath = join(this.storeDirectory, integrity)

    if (existsSync(targetPath)) {
      rmSync(targetPath, { force: true, recursive: true })
    }

    const index = this.readIndex()
    index.packages = index.packages.filter((entry) => entry.integrity !== integrity)
    this.writeIndex(index)
  }

  /**
   * Clears the entire store.
   */
  public clean(): void {
    if (existsSync(this.storeDirectory)) {
      rmSync(this.storeDirectory, { force: true, recursive: true })
    }

    mkdirSync(this.storeDirectory, { recursive: true })
    this.writeIndex({ packages: [] })
  }

  private readIndex(): StoreIndex & { packages: StoreIndexEntry[] } {
    if (!existsSync(this.indexPath)) {
      return { packages: [] }
    }

    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, 'utf8')) as {
        packages?: readonly StoreIndexEntry[]
      }

      return { packages: [...(parsed.packages ?? [])] }
    } catch {
      return { packages: [] }
    }
  }

  private writeIndex(index: StoreIndex): void {
    mkdirSync(this._root, { recursive: true })
    writeFileSync(this.indexPath, `${JSON.stringify(index, null, 2)}\n`)
  }
}

function getDefaultStoreRoot(): string {
  if (platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA

    return join(localAppData ?? join(homedir(), 'AppData', 'Local'), 'LiveScript')
  }

  return join(homedir(), '.livescript')
}

function computeDirectoryHash(directory: string): string {
  const hash = createHash('sha256')
  const files = collectFiles(directory).sort()

  for (const relativePath of files) {
    hash.update(relativePath)
    hash.update('\0')
    hash.update(readFileSync(join(directory, relativePath)))
    hash.update('\0')
  }

  return hash.digest('hex')
}

function collectFiles(directory: string, base: string = directory): string[] {
  const result: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)

    if (entry.isDirectory()) {
      result.push(...collectFiles(fullPath, base))
    } else if (entry.isFile()) {
      result.push(fullPath.slice(base.length + 1))
    }
  }

  return result
}

function compareVersionsDescending(a: StoreIndexEntry, b: StoreIndexEntry): number {
  return compareVersions(b.version, a.version)
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0

    if (leftValue !== rightValue) {
      return leftValue - rightValue
    }
  }

  return 0
}
