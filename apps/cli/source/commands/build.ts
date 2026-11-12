import { join, parse } from 'node:path'

import { Command } from 'commander'

import { buildExecutable, requireClang } from '../services/clang.js'
import { compileFile } from '../services/compiler.js'
import { reportDiagnostics, reportError } from '../services/diagnostics.js'
import { resolveInvocationPath } from '../services/paths.js'

/** Options of the build command. */
export interface BuildOptions {
  readonly global?: readonly string[]
  readonly output?: string
}

/**
 * Creates the command that compiles a Livescript file into a native executable.
 *
 * @returns The build command.
 */
export function buildCommand(): Command {
  return new Command('build')
    .description('Compile a Livescript file into a native executable')
    .argument('<file>', 'Livescript source file')
    .option('-g, --global <name...>', 'Names available in the global scope without being declared')
    .option('-o, --output <path>', 'Path of the executable')
    .action((file: string, options: BuildOptions) => {
      try {
        const { diagnostics, ir } = compileFile(file, { globals: options.global })

        if (reportDiagnostics(file, diagnostics)) {
          process.exitCode = 1

          return
        }

        requireClang()

        const output = resolveInvocationPath(options.output ?? outputNameOf(file))
        const status = buildExecutable(ir, output)

        if (status !== 0) {
          process.exitCode = status

          return
        }

        console.log(`Compiled ${file} to ${output}`)
      } catch (error) {
        reportError(file, error)
        process.exitCode = 1
      }
    })
}

/**
 * Returns the default output path of a source file.
 */
function outputNameOf(file: string): string {
  const parsed = parse(file)

  return join(parsed.dir, parsed.name)
}
