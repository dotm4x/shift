#!/usr/bin/env node
import { Command } from 'commander'

import { commandFactories } from './commands/index.js'

const program = new Command()

/**
 * Collects repeated `--filter` values into a list, so `shift --filter a --filter b run`
 * selects both projects.
 */
function collectFilters(value: string, previous: readonly string[]): string[] {
  return [...previous, value]
}

program
  .name('shift')
  .description('The Shift compiler CLI')
  .version('0.1.0')
  .option(
    '-f, --filter <name>',
    'Restrict to projects matching the given names; repeatable',
    collectFilters,
    [],
  )
  .option('--path <directory>', 'Run the command as if started in the given directory')

for (const factory of commandFactories) {
  program.addCommand(factory())
}

try {
  program.parse(process.argv)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
