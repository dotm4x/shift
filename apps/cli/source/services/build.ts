import { join } from 'node:path'

import {
  discoverWorkspaceProjects,
  type ProjectManifest,
  readWorkspaceManifest,
  topologicalOrder,
} from '@livescript/project'

import { buildModules, requireClang } from './clang.js'
import { compileProject } from './compiler.js'
import { entryOf, matchesFilters, outputOf, resolveInstalledPackages } from './project.js'

/**
 * Compiles a project's entry module graph and links it into a native executable.
 *
 * @param projectRoot Absolute project root directory.
 * @param manifest Project manifest.
 * @param outputPath Path of the executable to produce.
 * @returns The exit status of the build.
 */
export function buildProjectAt(
  projectRoot: string,
  manifest: ProjectManifest,
  outputPath: string,
): number {
  const packages = resolveInstalledPackages(manifest)
  const modules = compileProject(join(projectRoot, entryOf(manifest)), packages)

  requireClang()

  return buildModules(modules, outputPath)
}

/**
 * Builds every executable project of a workspace in topological order.
 *
 * @param workspaceRoot Absolute workspace root directory.
 * @param filters Optional project name filters; every executable matches when omitted.
 * @returns The first non-zero build status, or zero when every build succeeds.
 */
export function buildWorkspace(workspaceRoot: string, filters?: readonly string[]): number {
  const manifest = readWorkspaceManifest(join(workspaceRoot, 'workspace.json'))
  const projects = topologicalOrder(discoverWorkspaceProjects(workspaceRoot, manifest))
  const selected = projects.filter((project) => matchesFilters(project.name, filters))
  const executables = selected.filter((project) => project.manifest.type === 'executable')

  if (selected.length === 0) {
    throw new Error(
      `No workspace project matches the given filter. Available: ${projects.map((project) => project.name).join(', ')}.`,
    )
  }

  if (executables.length === 0) {
    console.log('The selected workspace projects have no executables to build.')

    return 0
  }

  for (const project of executables) {
    const output = outputOf(project.manifest, project.root)
    console.log(`Building ${project.name}...`)

    const status = buildProjectAt(project.root, project.manifest, output)

    if (status !== 0) {
      return status
    }

    console.log(`Built ${project.name} to ${output}`)
  }

  return 0
}
