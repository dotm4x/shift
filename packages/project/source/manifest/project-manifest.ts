import { readFileSync } from 'node:fs'

/** Supported project types. */
export type ProjectType = 'executable' | 'library'

/** Build configuration of a project. */
export interface ProjectBuildConfiguration {
  /** Compilation target, such as `native`. */
  readonly target?: string
  /** Output directory for build artifacts. */
  readonly output?: string
  /** Optimization level. */
  readonly optimization?: 'debug' | 'release'
}

/** Compiler options of a project. */
export interface ProjectCompilerConfiguration {
  /** Names available in the global scope without being declared. */
  readonly globals?: readonly string[]
}

/** A parsed and validated LiveScript project manifest (`project.json`). */
export interface ProjectManifest {
  /** Project or package name, possibly hierarchical (`@fable/core/graphics`). */
  readonly name: string
  /** Semantic version. */
  readonly version: string
  /** Project type. */
  readonly type: ProjectType
  /** Human-readable description. */
  readonly description?: string
  /** Entry source file, relative to the project root. */
  readonly entry?: string
  /** Required LiveScript SDK version. */
  readonly sdk?: string
  /** Runtime dependencies, mapped to version constraints. */
  readonly dependencies?: Readonly<{ [key: string]: string }>
  /** Development dependencies, mapped to version constraints. */
  readonly developmentDependencies?: Readonly<{ [key: string]: string }>
  /** Build configuration. */
  readonly build?: ProjectBuildConfiguration
  /** Compiler configuration. */
  readonly compiler?: ProjectCompilerConfiguration
  /** Named shell scripts, executed from the project root. */
  readonly scripts?: Readonly<{ [key: string]: string }>
}

/** Error thrown when a manifest is invalid. */
export class ProjectManifestError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ProjectManifestError'
  }
}

const validTypes: readonly ProjectType[] = ['executable', 'library']
const validOptimizations = ['debug', 'release'] as const

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProjectManifestError(`'${field}' must be a non-empty string.`)
  }

  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return requireString(value, field)
}

function validateVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
    throw new ProjectManifestError(`'version' must be a semantic version, got '${version}'.`)
  }
}

function validateName(name: string): void {
  if (!/^[@a-zA-Z0-9][@a-zA-Z0-9._/-]*$/.test(name)) {
    throw new ProjectManifestError(`'name' contains invalid characters: '${name}'.`)
  }
}

function validateDependencies(
  value: unknown,
  field: string,
): Readonly<{ [key: string]: string }> | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new ProjectManifestError(`'${field}' must be an object.`)
  }

  const result: { [key: string]: string } = {}

  for (const [key, constraint] of Object.entries(value)) {
    validateName(key)

    if (typeof constraint !== 'string' || constraint.trim() === '') {
      throw new ProjectManifestError(
        `Dependency '${key}' in '${field}' must have a non-empty version constraint.`,
      )
    }

    result[key] = constraint
  }

  return result
}

/**
 * Parses and validates a project manifest from a JSON string.
 *
 * @param text JSON text of the manifest.
 * @returns The validated manifest.
 * @throws {ProjectManifestError} When the manifest is invalid.
 */
export function parseProjectManifest(text: string): ProjectManifest {
  let raw: unknown

  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new ProjectManifestError(
      `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!isRecord(raw)) {
    throw new ProjectManifestError('Manifest must be a JSON object.')
  }

  const name = requireString(raw.name, 'name')
  validateName(name)

  const version = requireString(raw.version, 'version')
  validateVersion(version)

  const typeRaw = raw.type ?? 'library'

  if (typeof typeRaw !== 'string' || !validTypes.includes(typeRaw as ProjectType)) {
    throw new ProjectManifestError(`'type' must be one of: ${validTypes.join(', ')}.`)
  }

  const type = typeRaw as ProjectType

  const description = optionalString(raw.description, 'description')
  const entry = optionalString(raw.entry, 'entry')
  const sdk = optionalString(raw.sdk, 'sdk')

  const dependencies = validateDependencies(raw.dependencies, 'dependencies')
  const developmentDependencies = validateDependencies(
    raw.developmentDependencies,
    'developmentDependencies',
  )

  let build: ProjectBuildConfiguration | undefined

  if (raw.build !== undefined) {
    if (!isRecord(raw.build)) {
      throw new ProjectManifestError("'build' must be an object.")
    }

    const target = optionalString(raw.build.target, 'build.target')
    const output = optionalString(raw.build.output, 'build.output')

    let optimization: 'debug' | 'release' | undefined

    if (raw.build.optimization !== undefined) {
      if (
        typeof raw.build.optimization !== 'string' ||
        !validOptimizations.includes(raw.build.optimization as 'debug' | 'release')
      ) {
        throw new ProjectManifestError("'build.optimization' must be 'debug' or 'release'.")
      }

      optimization = raw.build.optimization as 'debug' | 'release'
    }

    const buildValue: ProjectBuildConfiguration = {}

    if (target !== undefined) {
      ;(buildValue as { target?: string }).target = target
    }

    if (output !== undefined) {
      ;(buildValue as { output?: string }).output = output
    }

    if (optimization !== undefined) {
      ;(buildValue as { optimization?: 'debug' | 'release' }).optimization = optimization
    }

    build = buildValue
  }

  let compiler: ProjectCompilerConfiguration | undefined

  if (raw.compiler !== undefined) {
    if (!isRecord(raw.compiler)) {
      throw new ProjectManifestError("'compiler' must be an object.")
    }

    let globals: readonly string[] | undefined

    if (raw.compiler.globals !== undefined) {
      if (
        !Array.isArray(raw.compiler.globals) ||
        !raw.compiler.globals.every((item) => typeof item === 'string')
      ) {
        throw new ProjectManifestError("'compiler.globals' must be an array of strings.")
      }

      globals = raw.compiler.globals
    }

    compiler = globals === undefined ? {} : { globals }
  }

  let scripts: Readonly<{ [key: string]: string }> | undefined

  if (raw.scripts !== undefined) {
    if (!isRecord(raw.scripts)) {
      throw new ProjectManifestError("'scripts' must be an object.")
    }

    const scriptEntries: { [key: string]: string } = {}

    for (const [scriptName, command] of Object.entries(raw.scripts)) {
      if (typeof command !== 'string' || command.trim() === '') {
        throw new ProjectManifestError(`Script '${scriptName}' must have a non-empty command.`)
      }

      scriptEntries[scriptName] = command
    }

    scripts = scriptEntries
  }

  const result: ProjectManifest = {
    name,
    version,
    type,
  }

  if (description !== undefined) {
    ;(result as { description?: string }).description = description
  }

  if (entry !== undefined) {
    ;(result as { entry?: string }).entry = entry
  }

  if (sdk !== undefined) {
    ;(result as { sdk?: string }).sdk = sdk
  }

  if (dependencies !== undefined) {
    ;(result as { dependencies?: Readonly<{ [key: string]: string }> }).dependencies = dependencies
  }

  if (developmentDependencies !== undefined) {
    ;(
      result as { developmentDependencies?: Readonly<{ [key: string]: string }> }
    ).developmentDependencies = developmentDependencies
  }

  if (build !== undefined) {
    ;(result as { build?: ProjectBuildConfiguration }).build = build
  }

  if (compiler !== undefined) {
    ;(result as { compiler?: ProjectCompilerConfiguration }).compiler = compiler
  }

  if (scripts !== undefined) {
    ;(result as { scripts?: Readonly<{ [key: string]: string }> }).scripts = scripts
  }

  return result
}

/**
 * Reads and parses a project manifest from a file.
 *
 * @param path Absolute path to `project.json`.
 * @returns The validated manifest.
 */
export function readProjectManifest(path: string): ProjectManifest {
  return parseProjectManifest(readFileSync(path, 'utf8'))
}

/**
 * Serializes a manifest to pretty JSON.
 *
 * @param manifest Manifest to serialize.
 * @returns JSON text.
 */
export function serializeProjectManifest(manifest: ProjectManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}
