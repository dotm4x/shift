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
}

/**
 * Resolves import specifiers into file paths using configurable aliases.
 */
export class ModuleResolver {
  private readonly _aliases: readonly PathAlias[]

  /**
   * @param options Resolver options. The defaults resolve relative specifiers only.
   */
  public constructor(options: ModuleResolverOptions = {}) {
    this._aliases = options.aliases ?? []
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

    throw new Error(`Unknown import specifier '${specifier}'.`)
  }
}
