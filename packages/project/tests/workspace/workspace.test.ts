import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  parseWorkspaceManifest,
  WorkspaceManifestError,
} from '../../source/workspace/workspace-manifest.js'
import {
  discoverWorkspaceProjects,
  findWorkspaceRoot,
  loadWorkspaceProjects,
  topologicalOrder,
} from '../../source/workspace/workspace.js'

let directories: string[] = []

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'shift-workspace-'))
  directories.push(directory)

  return directory
}

afterEach(() => {
  for (const directory of directories) {
    rmSync(directory, { force: true, recursive: true })
  }

  directories = []
})

function createProject(
  root: string,
  directory: string,
  name: string,
  dependencies: { [key: string]: string } = {},
): string {
  const projectRoot = join(root, directory)
  mkdirSync(projectRoot, { recursive: true })
  writeFileSync(
    join(projectRoot, 'project.json'),
    JSON.stringify({ name, version: '1.0.0', type: 'library', dependencies }),
  )

  return projectRoot
}

describe('parseWorkspaceManifest', () => {
  it('parses a valid manifest', () => {
    const manifest = parseWorkspaceManifest(
      '{"name":"my-workspace","members":["applications/*","libraries/*"]}',
    )

    expect(manifest.name).toBe('my-workspace')
    expect(manifest.members).toEqual(['applications/*', 'libraries/*'])
  })

  it('rejects invalid JSON', () => {
    expect(() => parseWorkspaceManifest('{')).toThrow(WorkspaceManifestError)
  })

  it('rejects missing members', () => {
    expect(() => parseWorkspaceManifest('{"name":"w"}')).toThrow(WorkspaceManifestError)
  })

  it('parses scripts', () => {
    const manifest = parseWorkspaceManifest('{"members":["apps/*"],"scripts":{"test":"echo hi"}}')

    expect(manifest.scripts?.test).toBe('echo hi')
  })

  it('rejects empty script commands', () => {
    expect(() => parseWorkspaceManifest('{"members":[],"scripts":{"test":""}}')).toThrow(
      WorkspaceManifestError,
    )
  })
})

describe('discoverWorkspaceProjects', () => {
  it('discovers projects matching member patterns', () => {
    const root = createTemporaryDirectory()
    createProject(root, 'applications/api', 'api')
    createProject(root, 'libraries/core', 'core')
    writeFileSync(join(root, 'workspace.json'), '{"members":["applications/*","libraries/*"]}')

    const manifest = parseWorkspaceManifest('{"members":["applications/*","libraries/*"]}')
    const projects = discoverWorkspaceProjects(root, manifest)

    expect(projects.map((project) => project.name).sort()).toEqual(['api', 'core'])
  })

  it('links internal dependencies', () => {
    const root = createTemporaryDirectory()
    createProject(root, 'applications/api', 'api', { core: '^1.0.0' })
    createProject(root, 'libraries/core', 'core')

    const manifest = parseWorkspaceManifest('{"members":["applications/*","libraries/*"]}')
    const projects = discoverWorkspaceProjects(root, manifest)
    const api = projects.find((project) => project.name === 'api')

    expect(api?.internalDependencies).toEqual(['core'])
  })

  it('rejects workspace constraints on non-members', () => {
    const root = createTemporaryDirectory()
    createProject(root, 'applications/api', 'api', { missing: 'workspace:*' })

    const manifest = parseWorkspaceManifest('{"members":["applications/*"]}')

    expect(() => discoverWorkspaceProjects(root, manifest)).toThrow(WorkspaceManifestError)
  })
})

describe('topologicalOrder', () => {
  it('orders dependencies before dependents', () => {
    const root = createTemporaryDirectory()
    createProject(root, 'applications/api', 'api', { core: '^1.0.0' })
    createProject(root, 'libraries/core', 'core')

    const manifest = parseWorkspaceManifest('{"members":["applications/*","libraries/*"]}')
    const order = topologicalOrder(discoverWorkspaceProjects(root, manifest))

    expect(order.map((project) => project.name)).toEqual(['core', 'api'])
  })

  it('detects circular dependencies', () => {
    const root = createTemporaryDirectory()
    createProject(root, 'libraries/a', 'a', { b: '^1.0.0' })
    createProject(root, 'libraries/b', 'b', { a: '^1.0.0' })

    const manifest = parseWorkspaceManifest('{"members":["libraries/*"]}')

    expect(() => topologicalOrder(discoverWorkspaceProjects(root, manifest))).toThrow(
      /Circular workspace dependency/,
    )
  })
})

describe('findWorkspaceRoot and loadWorkspaceProjects', () => {
  it('finds the workspace from a nested project', () => {
    const root = createTemporaryDirectory()
    createProject(root, 'libraries/core', 'core')
    writeFileSync(join(root, 'workspace.json'), '{"members":["libraries/*"]}')

    expect(findWorkspaceRoot(join(root, 'libraries', 'core'))).toBe(root)
    expect(
      loadWorkspaceProjects(join(root, 'libraries', 'core')).map((project) => project.name),
    ).toEqual(['core'])
  })

  it('returns undefined outside a workspace', () => {
    expect(findWorkspaceRoot(createTemporaryDirectory())).toBeUndefined()
  })
})
