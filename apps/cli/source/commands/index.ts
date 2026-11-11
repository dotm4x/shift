import type { Command } from 'commander'

import { buildCommand } from './build.js'
import { runCommand } from './run.js'

/** Factories of the commands available in the CLI, in registration order. */
export const commandFactories: readonly (() => Command)[] = [buildCommand, runCommand]
