import { join } from 'node:path'

import { Command } from 'commander'

import {
  discoverWorkspaceProjects,
  findWorkspaceRoot,
  type Lockfile,
  type LockfilePackage,
  PackageStore,
  parseProjectManifest,
  readWorkspaceManifest,
  resolveDependencies,
  topologicalOrder,
  writeLockfile,
} from '@shift/project'

import {
  findProjectRoot,
  matchesFilters,
  readManifestFromDirectory,
  resolveBaseDirectory,
} from '../services/project.js'

/** Options of the install command. */
export interface InstallOptions {
  readonly development?: boolean
  readonly frozen?: boolean
  readonly path?: string
}

/**
 * Creates the command that installs project or workspace dependencies into the global store.
 *
 * The global `--filter` option restricts workspace installs to matching projects and `--path`
 * runs the command as if started in the given directory.
 *
 * @returns The install command.
 */
export function installCommand(): Command {
  const command = new Command('install')
    .description('Resolve and install project dependencies')
    .option('-d, --development', 'Include development dependencies')
    .option('--frozen', 'Fail if the lockfile would change')
    .option('--path <directory>', 'Run the command as if started in the given directory')
    .action((options: InstallOptions) => {
      try {
        const globalOptions = command.optsWithGlobals<{
          filter?: readonly string[]
          path?: string
        }>()
        const filters = globalOptions.filter
        const base = resolveBaseDirectory(globalOptions.path)
        const workspaceRoot = findWorkspaceRoot(base)

        if (workspaceRoot !== undefined) {
          installWorkspace(workspaceRoot, filters, options)

          return
        }

        installProject(base, options)
      } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
      }
    })

  return command
}

function installProject(base: string, options: InstallOptions): void {
  const root = findProjectRoot(base)

  if (root === undefined) {
    throw new Error('No project.json found in the current directory or its parents.')
  }

  const manifest = readManifestFromDirectory(root)
  const store = new PackageStore()
  const result = resolveDependencies(manifest, store, options.development === true)

  writeLockfile(join(root, 'project.lock'), result.lockfile)
  console.log(`Installed ${String(result.resolved.size)} package(s).`)
}

function installWorkspace(
  workspaceRoot: string,
  filters: readonly string[] | undefined,
  options: InstallOptions,
): void {
  const manifest = readWorkspaceManifest(join(workspaceRoot, 'workspace.json'))
  const allProjects = topologicalOrder(discoverWorkspaceProjects(workspaceRoot, manifest))
  const projects = allProjects.filter((project) => matchesFilters(project.name, filters))

  if (projects.length === 0) {
    throw new Error(
      `No workspace project matches the given filter. Available: ${allProjects.map((project) => project.name).join(', ')}.`,
    )
  }

  const store = new PackageStore()
  const packages: { [key: string]: LockfilePackage } = {}

  // Member projects are added to the store first so internal dependencies resolve locally.
  for (const project of projects) {
    store.addLocalPackage(project.root)
  }

  for (const project of projects) {
    const projectManifest = parseProjectManifest(JSON.stringify(project.manifest))
    const result = resolveDependencies(projectManifest, store, options.development === true)

    for (const [key, entry] of result.resolved) {
      packages[key] = {
        name: entry.name,
        version: entry.version,
        integrity: entry.integrity,
        source: 'local',
        dependencies: entry.dependencies,
      }
    }
  }

  const lockfile: Lockfile = { lockfileVersion: 1, packages }
  writeLockfile(join(workspaceRoot, 'project.lock'), lockfile)
  console.log(
    `Installed ${String(Object.keys(packages).length)} package(s) for ${String(projects.length)} project(s).`,
  )
}
