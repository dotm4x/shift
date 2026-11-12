import { Command } from 'commander'

import { PackageStore } from '@livescript/project'

/**
 * Creates the command that manages the global package cache.
 *
 * @returns The cache command.
 */
export function cacheCommand(): Command {
  const command = new Command('cache').description('Manage the global package cache')

  command
    .command('list')
    .description('List packages in the global cache')
    .action(() => {
      try {
        const store = new PackageStore()
        const packages = store.list()

        if (packages.length === 0) {
          console.log('The cache is empty.')
          return
        }

        for (const pkg of packages) {
          console.log(`${pkg.name}@${pkg.version}  ${pkg.integrity}`)
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
      }
    })

  command
    .command('clean')
    .description('Remove all packages from the global cache')
    .action(() => {
      try {
        const store = new PackageStore()
        store.clean()
        console.log('Cache cleaned.')
      } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
      }
    })

  command
    .command('inspect')
    .description('Show the cache root directory')
    .action(() => {
      const store = new PackageStore()
      console.log(store.root)
    })

  return command
}
