import { Command } from 'commander'

import { buildAndRun, requireClang } from '../services/clang.js'
import { compileFile } from '../services/compiler.js'
import { reportDiagnostics, reportError } from '../services/diagnostics.js'

/**
 * Creates the command that compiles a Livescript file and runs it.
 *
 * @returns The run command.
 */
export function runCommand(): Command {
  return new Command('run')
    .description('Compile a Livescript file and run it')
    .argument('<file>', 'Livescript source file')
    .option('-g, --global <name...>', 'Names available in the global scope without being declared')
    .action((file: string, options: { global?: readonly string[] }) => {
      try {
        const { diagnostics, ir } = compileFile(file, { globals: options.global })

        if (reportDiagnostics(file, diagnostics)) {
          process.exitCode = 1

          return
        }

        requireClang()

        process.exitCode = buildAndRun(ir)
      } catch (error) {
        reportError(file, error)
        process.exitCode = 1
      }
    })
}
