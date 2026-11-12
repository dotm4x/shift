import { readFileSync } from 'node:fs'

/** A parsed and validated workspace manifest (`workspace.json`). */
export interface WorkspaceManifest {
  /** Glob patterns of member project directories, relative to the workspace root. */
  readonly members: readonly string[]
  /** Workspace name. */
  readonly name?: string
  /** Named shell scripts, executed from the workspace root. */
  readonly scripts?: Readonly<{ [key: string]: string }>
}

/** Error thrown when a workspace manifest is invalid. */
export class WorkspaceManifestError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'WorkspaceManifestError'
  }
}

/**
 * Parses and validates a workspace manifest from JSON text.
 *
 * @param text JSON text.
 * @returns The validated manifest.
 */
export function parseWorkspaceManifest(text: string): WorkspaceManifest {
  let raw: unknown

  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new WorkspaceManifestError(
      `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new WorkspaceManifestError('Workspace manifest must be a JSON object.')
  }

  const record = raw as { name?: unknown; members?: unknown; scripts?: unknown }

  if (
    !Array.isArray(record.members) ||
    !record.members.every((member) => typeof member === 'string')
  ) {
    throw new WorkspaceManifestError("'members' must be an array of strings.")
  }

  const name = typeof record.name === 'string' ? record.name : undefined
  const result: WorkspaceManifest = { members: record.members }

  if (name !== undefined) {
    ;(result as { name?: string }).name = name
  }

  if (record.scripts !== undefined) {
    if (
      typeof record.scripts !== 'object' ||
      record.scripts === null ||
      Array.isArray(record.scripts)
    ) {
      throw new WorkspaceManifestError("'scripts' must be an object.")
    }

    const scriptEntries: { [key: string]: string } = {}

    for (const [scriptName, command] of Object.entries(record.scripts)) {
      if (typeof command !== 'string' || command.trim() === '') {
        throw new WorkspaceManifestError(`Script '${scriptName}' must have a non-empty command.`)
      }

      scriptEntries[scriptName] = command
    }

    ;(result as { scripts?: Readonly<{ [key: string]: string }> }).scripts = scriptEntries
  }

  return result
}

/**
 * Reads a workspace manifest from a file.
 *
 * @param path Absolute path to `workspace.json`.
 * @returns The validated manifest.
 */
export function readWorkspaceManifest(path: string): WorkspaceManifest {
  return parseWorkspaceManifest(readFileSync(path, 'utf8'))
}
