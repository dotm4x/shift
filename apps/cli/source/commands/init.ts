import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Command } from 'commander'

import { type ProjectManifest, serializeProjectManifest } from '@livescript/project'

import { resolveInvocationPath } from '../services/paths.js'

/** Options of the init command. */
export interface InitOptions {
  readonly name?: string
  readonly type?: 'executable' | 'library'
}

/**
 * Creates the command that initializes a new LiveScript project.
 *
 * @returns The init command.
 */
export function initCommand(): Command {
  return new Command('init')
    .description('Initialize a new LiveScript project')
    .argument('[directory]', 'Project directory', '.')
    .option('-n, --name <name>', 'Project name')
    .option('-t, --type <type>', 'Project type (executable or library)', 'executable')
    .action((directory: string, options: InitOptions) => {
      try {
        const root = resolveInvocationPath(directory)
        mkdirSync(root, { recursive: true })

        const name = options.name ?? directory.split(/[\\/]/).filter(Boolean).pop() ?? 'my-project'
        const type = options.type === 'library' ? 'library' : 'executable'

        const manifest: ProjectManifest = {
          name,
          version: '0.1.0',
          type,
          entry: type === 'executable' ? 'src/main.ls' : 'src/index.ls',
        }

        writeFileSync(join(root, 'project.json'), serializeProjectManifest(manifest))
        mkdirSync(join(root, 'src'), { recursive: true })

        console.log(`Initialized LiveScript project '${name}' in ${root}`)
      } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
      }
    })
}
