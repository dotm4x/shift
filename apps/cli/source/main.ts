#!/usr/bin/env node
import { Command } from 'commander'

import { commandFactories } from './commands/index.js'

const program = new Command()

program.name('livescript').description('The Livescript compiler CLI').version('0.1.0')

for (const factory of commandFactories) {
  program.addCommand(factory())
}

try {
  program.parse(process.argv)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
