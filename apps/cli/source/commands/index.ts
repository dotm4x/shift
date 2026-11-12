import type { Command } from 'commander'

import { addCommand } from './add.js'
import { buildCommand } from './build.js'
import { cacheCommand } from './cache.js'
import { cleanCommand } from './clean.js'
import { initCommand } from './init.js'
import { installCommand } from './install.js'
import { packageCommand } from './package.js'
import { removeCommand } from './remove.js'
import { runCommand } from './run.js'
import { scriptCommand } from './script.js'
import { workspaceCommand } from './workspace.js'

/** Factories of the commands available in the CLI, in registration order. */
export const commandFactories: readonly (() => Command)[] = [
  initCommand,
  addCommand,
  removeCommand,
  installCommand,
  buildCommand,
  runCommand,
  scriptCommand,
  cleanCommand,
  cacheCommand,
  packageCommand,
  workspaceCommand,
]
