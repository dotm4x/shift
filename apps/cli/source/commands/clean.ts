import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { Command } from 'commander'

import { discoverWorkspaceProjects, findWorkspaceRoot, readWorkspaceManifest } from '@shift/project'

import { reportError } from '../services/diagnostics.js'
import {
  findProjectRoot,
  matchesFilters,
  readManifestFromDirectory,
  resolveBaseDirectory,
} from '../services/project.js'

/** Options of the clean command. */
export interface CleanOptions {
  readonly path?: string
}

/**
 * Creates the command that removes build artifacts.
 *
 * Without arguments it cleans the current project, or every project of the current workspace. The
 * global `--filter` option restricts workspace cleans to matching projects and `--path` runs the
 * command as if started in the given directory.
 *
 * @returns The clean command.
 */
export function cleanCommand(): Command {
  const command = new Command('clean')
    .description('Remove build artifacts of the current project or workspace')
    .option('--path <directory>', 'Run the command as if started in the given directory')
    .action(() => {
      try {
        const globalOptions = command.optsWithGlobals<{
          filter?: readonly string[]
          path?: string
        }>()
        const filters = globalOptions.filter
        const base = resolveBaseDirectory(globalOptions.path)
        const projectRoot = findProjectRoot(base)

        if (projectRoot !== undefined) {
          const manifest = readManifestFromDirectory(projectRoot)

          if (!matchesFilters(manifest.name, filters)) {
            throw new Error(`Project '${manifest.name}' does not match the given filter.`)
          }

          cleanProject(projectRoot, manifest)

          return
        }

        const workspaceRoot = findWorkspaceRoot(base)

        if (workspaceRoot !== undefined) {
          cleanWorkspace(workspaceRoot, filters)

          return
        }

        throw new Error(
          'No project.json or workspace.json found in the current directory or its parents.',
        )
      } catch (error) {
        reportError('clean', error)
        process.exitCode = 1
      }
    })

  return command
}

/**
 * Removes the build output directory of a project.
 */
function cleanProject(
  projectRoot: string,
  manifest: { readonly name: string; readonly build?: { readonly output?: string } },
): void {
  const output = join(projectRoot, manifest.build?.output ?? 'build')

  rmSync(output, { force: true, recursive: true })
  console.log(`Cleaned ${manifest.name}.`)
}

/**
 * Removes the build output directory of every matching workspace project.
 */
function cleanWorkspace(workspaceRoot: string, filters?: readonly string[]): void {
  const manifest = readWorkspaceManifest(join(workspaceRoot, 'workspace.json'))
  const projects = discoverWorkspaceProjects(workspaceRoot, manifest).filter((project) =>
    matchesFilters(project.name, filters),
  )

  if (projects.length === 0) {
    throw new Error('No workspace project matches the given filter.')
  }

  for (const project of projects) {
    cleanProject(project.root, project.manifest)
  }
}
