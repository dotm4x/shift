/** A path alias that maps an import prefix to a base directory. */
export interface PathAlias {
  /** Prefix of the import specifier, such as `packages`. */
  readonly prefix: string
  /** Base directory the prefix resolves to. */
  readonly base: string
}

/** Options of the module resolver. */
export interface ModuleResolverOptions {
  /** Path aliases used to resolve import specifiers. */
  readonly aliases?: readonly PathAlias[]
  /** Installed packages mapped from package name to their base directory in the store. */
  readonly packages?: ReadonlyMap<string, string>
}

/**
 * Resolves import specifiers into file paths using configurable aliases.
 */
export class ModuleResolver {
  private readonly _aliases: readonly PathAlias[]
  private readonly _packages: ReadonlyMap<string, string>

  /**
   * @param options Resolver options. The defaults resolve relative specifiers only.
   */
  public constructor(options: ModuleResolverOptions = {}) {
    this._aliases = options.aliases ?? []
    this._packages = options.packages ?? new Map()
  }

  /**
   * Resolves an import specifier into a file path.
   *
   * @param specifier Import specifier, such as `./math` or `packages:colorify`.
   * @param fromPath Directory of the importing file.
   * @returns Resolved file path without extension.
   * @throws When the specifier uses an unknown alias.
   */
  public resolve(specifier: string, fromPath: string): string {
    const alias = this._aliases.find((candidate) => specifier.startsWith(`${candidate.prefix}:`))

    if (alias !== undefined) {
      const rest = specifier.slice(alias.prefix.length + 1)

      return `${alias.base}/${rest}`
    }

    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const directory = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '.'

      return `${directory}/${specifier}`
    }

    // Resolve installed package names, supporting hierarchical names and subpaths.
    const packageMatch = resolvePackageName(specifier, this._packages)

    if (packageMatch !== undefined) {
      const [packageName, subpath] = packageMatch
      const base = this._packages.get(packageName)

      if (base === undefined) {
        throw new Error(`Unknown import specifier '${specifier}'.`)
      }

      return subpath === '' ? base : `${base}/${subpath}`
    }

    throw new Error(`Unknown import specifier '${specifier}'.`)
  }
}

/**
 * Finds the longest matching package name for a specifier.
 *
 * @param specifier Import specifier.
 * @param packages Installed packages.
 * @returns A tuple of package name and remaining subpath, or `undefined`.
 */
function resolvePackageName(
  specifier: string,
  packages: ReadonlyMap<string, string>,
): [string, string] | undefined {
  let bestName: string | undefined

  for (const name of packages.keys()) {
    if (specifier === name || specifier.startsWith(`${name}/`)) {
      if (bestName === undefined || name.length > bestName.length) {
        bestName = name
      }
    }
  }

  if (bestName === undefined) {
    return undefined
  }

  const subpath = specifier === bestName ? '' : specifier.slice(bestName.length + 1)

  return [bestName, subpath]
}
