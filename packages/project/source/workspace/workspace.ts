import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { parseProjectManifest, type ProjectManifest } from '../manifest/project-manifest.js'

import {
  readWorkspaceManifest,
  type WorkspaceManifest,
  WorkspaceManifestError,
} from './workspace-manifest.js'

/** A project discovered inside a workspace. */
export interface WorkspaceProject {
  /** Project name. */
  readonly name: string
  /** Project version. */
  readonly version: string
  /** Project manifest. */
  readonly manifest: ProjectManifest
  /** Absolute project root directory. */
  readonly root: string
  /** Names of workspace projects this project depends on. */
  readonly internalDependencies: readonly string[]
}

/**
 * Finds the nearest directory containing `workspace.json` starting from `start`.
 *
 * @param start Directory to start the search from.
 * @returns The workspace root, or `undefined` when there is no workspace.
 */
export function findWorkspaceRoot(start: string = process.cwd()): string | undefined {
  let current = resolve(start)
  let parent = resolve(current, '..')

  while (!existsSync(join(current, 'workspace.json')) && parent !== current) {
    current = parent
    parent = resolve(current, '..')
  }

  return existsSync(join(current, 'workspace.json')) ? current : undefined
}

/**
 * Discovers all member projects of a workspace.
 *
 * @param workspaceRoot Absolute workspace root directory.
 * @param manifest Workspace manifest.
 * @returns The discovered projects in discovery order.
 */
export function discoverWorkspaceProjects(
  workspaceRoot: string,
  manifest: WorkspaceManifest,
): readonly WorkspaceProject[] {
  const projects = new Map<string, WorkspaceProject>()

  for (const pattern of manifest.members) {
    for (const directory of matchMemberPattern(workspaceRoot, pattern)) {
      const manifestPath = join(directory, 'project.json')

      if (!existsSync(manifestPath)) {
        continue
      }

      const projectManifest = parseProjectManifest(readProjectManifestText(manifestPath))

      if (projects.has(projectManifest.name)) {
        throw new WorkspaceManifestError(
          `Duplicate project name '${projectManifest.name}' in the workspace.`,
        )
      }

      projects.set(projectManifest.name, {
        name: projectManifest.name,
        version: projectManifest.version,
        manifest: projectManifest,
        root: directory,
        internalDependencies: [],
      })
    }
  }

  linkInternalDependencies(projects)

  return [...projects.values()]
}

function readProjectManifestText(path: string): string {
  return readFileSync(path, 'utf8')
}

function matchMemberPattern(workspaceRoot: string, pattern: string): readonly string[] {
  const matcher = globToRegExp(pattern)
  const results: string[] = []

  visit(workspaceRoot, workspaceRoot, matcher, results)

  return results
}

function visit(root: string, directory: string, matcher: RegExp, results: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const fullPath = join(directory, entry.name)
    const relativePath = relative(root, fullPath).split('\\').join('/')

    if (matcher.test(relativePath)) {
      results.push(fullPath)
    }

    if (relativePath.split('/').length < 8) {
      visit(root, fullPath, matcher, results)
    }
  }
}

/**
 * Converts a glob pattern into a regular expression.
 *
 * @param pattern Glob pattern supporting `*` (one path segment), `**` (any depth), and `?`.
 * @returns The compiled regular expression.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = ''

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern.charAt(index)

    if (character === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*'
        index += 1

        if (pattern[index + 1] === '/') {
          index += 1
        }
      } else {
        source += '[^/]*'
      }
    } else if (character === '?') {
      source += '[^/]'
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }

  return new RegExp(`^${source}$`)
}

function linkInternalDependencies(projects: Map<string, WorkspaceProject>): void {
  for (const project of projects.values()) {
    const dependencies = {
      ...(project.manifest.dependencies ?? {}),
      ...(project.manifest.developmentDependencies ?? {}),
    }
    const internal: string[] = []

    for (const [name, constraint] of Object.entries(dependencies)) {
      if (projects.has(name)) {
        internal.push(name)
      } else if (constraint.startsWith('workspace:')) {
        throw new WorkspaceManifestError(
          `Project '${project.name}' depends on '${name}' with 'workspace:', but it is not a workspace member.`,
        )
      }
    }

    projects.set(project.name, { ...project, internalDependencies: internal })
  }
}

/**
 * Orders workspace projects so dependencies come before dependents.
 *
 * @param projects Discovered projects.
 * @returns Projects in topological build order.
 * @throws {WorkspaceManifestError} When the dependency graph has a cycle.
 */
export function topologicalOrder(
  projects: readonly WorkspaceProject[],
): readonly WorkspaceProject[] {
  const byName = new Map(projects.map((project) => [project.name, project]))
  const state = new Map<string, 'visiting' | 'done'>()
  const order: WorkspaceProject[] = []

  function visit(project: WorkspaceProject, path: readonly string[]): void {
    const current = state.get(project.name)

    if (current === 'done') {
      return
    }

    if (current === 'visiting') {
      throw new WorkspaceManifestError(
        `Circular workspace dependency: ${[...path, project.name].join(' -> ')}.`,
      )
    }

    state.set(project.name, 'visiting')

    for (const dependency of project.internalDependencies) {
      const target = byName.get(dependency)

      if (target !== undefined) {
        visit(target, [...path, project.name])
      }
    }

    state.set(project.name, 'done')
    order.push(project)
  }

  for (const project of projects) {
    visit(project, [])
  }

  return order
}

/**
 * Discovers and orders all projects of the workspace containing `start`.
 *
 * @param start Directory to start the search from.
 * @returns Projects in topological build order.
 */
export function loadWorkspaceProjects(start: string): readonly WorkspaceProject[] {
  const workspaceRoot = findWorkspaceRoot(start)

  if (workspaceRoot === undefined) {
    throw new WorkspaceManifestError(
      'No workspace.json found in the current directory or its parents.',
    )
  }

  const manifest = readWorkspaceManifest(join(workspaceRoot, 'workspace.json'))

  return topologicalOrder(discoverWorkspaceProjects(workspaceRoot, manifest))
}
