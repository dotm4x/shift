import { dirname, isAbsolute, join } from 'node:path'

import { Command } from 'commander'

import {
  discoverWorkspaceProjects,
  findWorkspaceRoot,
  readWorkspaceManifest,
  topologicalOrder,
} from '@livescript/project'

import { buildAndRunModules, requireClang } from '../services/clang.js'
import { compileProject } from '../services/compiler.js'
import { reportError } from '../services/diagnostics.js'
import {
  entryOf,
  findProjectRoot,
  matchesFilters,
  readManifestFromDirectory,
  resolveBaseDirectory,
  resolveInstalledPackages,
} from '../services/project.js'

/** Options of the run command. */
export interface RunOptions {
  readonly global?: readonly string[]
  readonly path?: string
}

/**
 * Creates the command that compiles and runs Livescript programs.
 *
 * Without arguments it compiles and runs the entry of the current executable project. Inside a
 * workspace it runs the single executable project, or the one selected with the global `--filter`
 * option. `--path` runs the command as if started in the given directory.
 *
 * @returns The run command.
 */
export function runCommand(): Command {
  const command = new Command('run')
    .description('Compile a Livescript file, or the current project, and run it')
    .argument('[file]', 'Livescript source file')
    .option('-g, --global <name...>', 'Names available in the global scope without being declared')
    .option('--path <directory>', 'Run the command as if started in the given directory')
    .action((file: string | undefined) => {
      try {
        const globalOptions = command.optsWithGlobals<{
          filter?: readonly string[]
          path?: string
        }>()
        const filters = globalOptions.filter
        const base = resolveBaseDirectory(globalOptions.path)
        const entryPath =
          file === undefined ? resolveRunTarget(base, filters) : resolveEntryPath(base, file)
        const projectRoot = findProjectRoot(dirname(entryPath))
        const manifest =
          projectRoot === undefined ? undefined : readManifestFromDirectory(projectRoot)
        const packages =
          manifest === undefined ? new Map<string, string>() : resolveInstalledPackages(manifest)

        const modules = compileProject(entryPath, packages)

        requireClang()

        process.exitCode = buildAndRunModules(modules)
      } catch (error) {
        reportError(file ?? 'run', error)
        process.exitCode = 1
      }
    })

  return command
}

/**
 * Resolves an explicit entry file against the base directory.
 */
function resolveEntryPath(base: string, file: string): string {
  return isAbsolute(file) ? file : join(base, file)
}

/**
 * Resolves the entry to run when no file is given.
 */
function resolveRunTarget(base: string, filters?: readonly string[]): string {
  const projectRoot = findProjectRoot(base)

  if (projectRoot !== undefined) {
    const manifest = readManifestFromDirectory(projectRoot)

    if (!matchesFilters(manifest.name, filters)) {
      throw new Error(`Project '${manifest.name}' does not match the given filter.`)
    }

    return join(projectRoot, entryOf(manifest))
  }

  const workspaceRoot = findWorkspaceRoot(base)

  if (workspaceRoot === undefined) {
    throw new Error(
      'No project.json or workspace.json found in the current directory or its parents.',
    )
  }

  const workspaceManifest = readWorkspaceManifest(join(workspaceRoot, 'workspace.json'))
  const executables = topologicalOrder(
    discoverWorkspaceProjects(workspaceRoot, workspaceManifest),
  ).filter(
    (project) => project.manifest.type === 'executable' && matchesFilters(project.name, filters),
  )

  if (executables.length === 0) {
    throw new Error('No executable workspace project matches the given filter.')
  }

  if (executables.length > 1) {
    const names = executables.map((project) => project.name).join(', ')

    throw new Error(`Multiple executable projects match: ${names}. Use --filter to select one.`)
  }

  const selected = executables[0]

  if (selected === undefined) {
    throw new Error('No executable workspace project matches the given filter.')
  }

  return join(selected.root, entryOf(selected.manifest))
}
