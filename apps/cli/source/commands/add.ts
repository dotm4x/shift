import { Command } from 'commander'

import type { ProjectManifest } from '@shift/project'

import {
  findProjectRoot,
  readManifestFromDirectory,
  writeManifestToDirectory,
} from '../services/project.js'

/** Options of the add command. */
export interface AddOptions {
  readonly development?: boolean
  readonly version?: string
}

/**
 * Creates the command that adds a dependency to the current project.
 *
 * @returns The add command.
 */
export function addCommand(): Command {
  return new Command('add')
    .description('Add a dependency to the current project')
    .argument('<name>', 'Dependency name')
    .option('-d, --development', 'Add as a development dependency')
    .option('-v, --version <constraint>', 'Version constraint', '*')
    .action((name: string, options: AddOptions) => {
      try {
        const root = findProjectRoot()

        if (root === undefined) {
          throw new Error('No project.json found in the current directory or its parents.')
        }

        const manifest = readManifestFromDirectory(root)
        const constraint = options.version ?? '*'
        const field = options.development === true ? 'developmentDependencies' : 'dependencies'
        const updated: ProjectManifest = {
          ...manifest,
          [field]: { ...(manifest[field] ?? {}), [name]: constraint },
        }

        writeManifestToDirectory(root, updated)
        console.log(`Added ${name}@${constraint} to ${field}.`)
      } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
      }
    })
}
