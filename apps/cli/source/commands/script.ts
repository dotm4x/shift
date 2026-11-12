import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Command } from 'commander'

import { findWorkspaceRoot, readWorkspaceManifest } from '@livescript/project'

import {
  findProjectRoot,
  readManifestFromDirectory,
  resolveBaseDirectory,
} from '../services/project.js'

/** Options of the script command. */
export interface ScriptOptions {
  readonly path?: string
}

/**
 * Creates the command that runs project or workspace scripts.
 *
 * `--path` runs the command as if started in the given directory.
 *
 * @returns The script command.
 */
export function scriptCommand(): Command {
  const command = new Command('script')
    .description('Run a script defined in project.json or workspace.json')
    .argument('[name]', 'Script name; lists the available scripts when omitted')
    .option('--path <directory>', 'Run the command as if started in the given directory')
    .action((name: string | undefined) => {
      try {
        const globalOptions = command.optsWithGlobals<{ path?: string }>()
        const location = resolveScriptLocation(resolveBaseDirectory(globalOptions.path))

        if (location === undefined) {
          throw new Error(
            'No project.json or workspace.json found in the current directory or its parents.',
          )
        }

        const scripts = location.scripts

        if (name === undefined) {
          listScripts(scripts)

          return
        }

        const commandText = scripts[name]

        if (commandText === undefined) {
          throw new Error(
            `Script '${name}' is not defined. Available: ${Object.keys(scripts).join(', ') || 'none'}.`,
          )
        }

        const environment = { ...process.env }

        const cliPath = cliEntryPath()

        if (cliPath !== undefined) {
          environment.LIVESCRIPT = cliPath
        }

        const result = spawnSync(commandText, {
          shell: true,
          stdio: 'inherit',
          cwd: location.root,
          env: environment,
        })

        process.exitCode = result.status ?? 1
      } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
      }
    })

  return command
}

interface ScriptLocation {
  readonly root: string
  readonly scripts: Readonly<{ [key: string]: string }>
}

/**
 * Finds the nearest manifest that defines scripts, preferring the project over the workspace.
 */
function resolveScriptLocation(base: string): ScriptLocation | undefined {
  const projectRoot = findProjectRoot(base)

  if (projectRoot !== undefined) {
    const manifest = readManifestFromDirectory(projectRoot)

    if (manifest.scripts !== undefined) {
      return { root: projectRoot, scripts: manifest.scripts }
    }
  }

  const workspaceRoot = findWorkspaceRoot(base)

  if (workspaceRoot !== undefined) {
    const manifest = readWorkspaceManifest(join(workspaceRoot, 'workspace.json'))

    if (manifest.scripts !== undefined) {
      return { root: workspaceRoot, scripts: manifest.scripts }
    }
  }

  return undefined
}

/**
 * Prints the available scripts.
 */
function listScripts(scripts: Readonly<{ [key: string]: string }>): void {
  const names = Object.keys(scripts)

  if (names.length === 0) {
    console.log('No scripts are defined.')

    return
  }

  for (const name of names) {
    const command = scripts[name]

    if (command !== undefined) {
      console.log(`${name}: ${command}`)
    }
  }
}

/**
 * Returns the path of the CLI entry file, when it can be located next to this module.
 */
function cliEntryPath(): string | undefined {
  const candidate = join(dirname(fileURLToPath(import.meta.url)), '..', 'main.js')

  return existsSync(candidate) ? candidate : undefined
}
