import { Command } from 'commander'

import { addArchivePackage, detectArchiveFormat, PackageStore } from '@shift/project'

import { resolveInvocationPath } from '../services/paths.js'

/**
 * Creates the command that inspects packages.
 *
 * @returns The package command.
 */
export function packageCommand(): Command {
  const command = new Command('package').description('Inspect packages')

  command
    .command('info')
    .description('Show information about an installed package')
    .argument('<name>', 'Package name')
    .action((name: string) => {
      try {
        const store = new PackageStore()
        const pkg = store.resolve(name)

        if (pkg === undefined) {
          throw new Error(`Package '${name}' is not installed.`)
        }

        console.log(`name: ${pkg.name}`)
        console.log(`version: ${pkg.version}`)
        console.log(`integrity: ${pkg.integrity}`)
        console.log(`path: ${pkg.path}`)
      } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
      }
    })

  command
    .command('add-local')
    .description('Add a local package directory to the global store')
    .argument('<path>', 'Path to the package directory')
    .action((sourcePath: string) => {
      try {
        const store = new PackageStore()
        const path = resolveInvocationPath(sourcePath)

        try {
          detectArchiveFormat(path)
          const stored = addArchivePackage(store, path)
          console.log(`Added ${stored.name}@${stored.version} (${stored.integrity}).`)
        } catch (formatError) {
          if (
            !(formatError instanceof Error) ||
            !formatError.message.startsWith('Unsupported archive format')
          ) {
            throw formatError
          }

          const stored = store.addLocalPackage(path)
          console.log(`Added ${stored.name}@${stored.version} (${stored.integrity}).`)
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
      }
    })

  return command
}
