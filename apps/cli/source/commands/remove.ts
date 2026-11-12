import { Command } from 'commander'

import type { ProjectManifest } from '@livescript/project'

import {
  findProjectRoot,
  readManifestFromDirectory,
  writeManifestToDirectory,
} from '../services/project.js'

/**
 * Creates the command that removes a dependency from the current project.
 *
 * @returns The remove command.
 */
export function removeCommand(): Command {
  return new Command('remove')
    .description('Remove a dependency from the current project')
    .argument('<name>', 'Dependency name')
    .option('-d, --development', 'Remove from development dependencies')
    .action((name: string, options: { development?: boolean }) => {
      try {
        const root = findProjectRoot()

        if (root === undefined) {
          throw new Error('No project.json found in the current directory or its parents.')
        }

        const manifest = readManifestFromDirectory(root)
        const field = options.development === true ? 'developmentDependencies' : 'dependencies'
        const previous = { ...(manifest[field] ?? {}) }
        const current = Object.fromEntries(Object.entries(previous).filter(([key]) => key !== name))

        if (Object.keys(current).length === Object.keys(previous).length) {
          throw new Error(`Dependency '${name}' is not listed in ${field}.`)
        }

        const updated: ProjectManifest = { ...manifest, [field]: current }
        writeManifestToDirectory(root, updated)
        console.log(`Removed ${name} from ${field}.`)
      } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
      }
    })
}
