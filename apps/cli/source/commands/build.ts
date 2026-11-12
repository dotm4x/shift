import { dirname, isAbsolute, join, parse } from 'node:path'

import { Command } from 'commander'

import { findWorkspaceRoot, type ProjectManifest } from '@shift/project'

import { buildProjectAt, buildWorkspace } from '../services/build.js'
import { buildModules, requireClang } from '../services/clang.js'
import { compileProject } from '../services/compiler.js'
import { reportError } from '../services/diagnostics.js'
import { resolveInvocationPath } from '../services/paths.js'
import {
  findProjectRoot,
  matchesFilters,
  outputOf,
  readManifestFromDirectory,
  resolveBaseDirectory,
  resolveInstalledPackages,
} from '../services/project.js'

/** Options of the build command. */
export interface BuildOptions {
  readonly global?: readonly string[]
  readonly output?: string
  readonly path?: string
}

/**
 * Creates the command that compiles Shift sources into native executables.
 *
 * Without arguments it builds the current project, or every executable project of the current
 * workspace in topological order. The global `--filter` option restricts workspace builds to
 * matching projects and `--path` runs the command as if started in the given directory.
 *
 * @returns The build command.
 */
export function buildCommand(): Command {
  const command = new Command('build')
    .description('Compile a Shift file, the current project, or a whole workspace')
    .argument('[file]', 'Shift source file')
    .option('-g, --global <name...>', 'Names available in the global scope without being declared')
    .option('-o, --output <path>', 'Path of the executable')
    .option('--path <directory>', 'Run the command as if started in the given directory')
    .action((file: string | undefined, options: BuildOptions) => {
      try {
        const globalOptions = command.optsWithGlobals<{
          filter?: readonly string[]
          path?: string
        }>()
        const filters = globalOptions.filter

        if (file !== undefined) {
          buildFile(file, options)

          return
        }

        const base = resolveBaseDirectory(globalOptions.path)
        const projectRoot = findProjectRoot(base)

        if (projectRoot !== undefined) {
          const manifest = readManifestFromDirectory(projectRoot)

          if (!matchesFilters(manifest.name, filters)) {
            throw new Error(`Project '${manifest.name}' does not match the given filter.`)
          }

          buildCurrentProject(projectRoot, manifest)

          return
        }

        const workspaceRoot = findWorkspaceRoot(base)

        if (workspaceRoot !== undefined) {
          process.exitCode = buildWorkspace(workspaceRoot, filters)

          return
        }

        throw new Error(
          'No project.json or workspace.json found in the current directory or its parents.',
        )
      } catch (error) {
        reportError(file ?? 'build', error)
        process.exitCode = 1
      }
    })

  return command
}

/**
 * Builds a single source file and its module graph.
 */
function buildFile(file: string, options: BuildOptions): void {
  const base = resolveBaseDirectory(options.path)
  const entryPath = isAbsolute(file) ? file : join(base, file)
  const projectRoot = findProjectRoot(dirname(entryPath))
  const manifest = projectRoot === undefined ? undefined : readManifestFromDirectory(projectRoot)
  const packages =
    manifest === undefined ? new Map<string, string>() : resolveInstalledPackages(manifest)

  const modules = compileProject(entryPath, packages)

  requireClang()

  const output = resolveInvocationPath(options.output ?? outputNameOf(file))
  const status = buildModules(modules, output)

  if (status !== 0) {
    process.exitCode = status

    return
  }

  console.log(`Compiled ${file} to ${output}`)
}

/**
 * Builds the project that contains the current directory.
 */
function buildCurrentProject(projectRoot: string, manifest: ProjectManifest): void {
  const output = outputOf(manifest, projectRoot)
  const status = buildProjectAt(projectRoot, manifest, output)

  if (status !== 0) {
    process.exitCode = status

    return
  }

  console.log(`Built ${manifest.name} to ${output}`)
}

/**
 * Returns the default output path of a source file.
 */
function outputNameOf(file: string): string {
  const parsed = parse(file)

  return join(parsed.dir, parsed.name)
}
