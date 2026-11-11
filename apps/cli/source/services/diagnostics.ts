import { type DiagnosticBag } from '@livescript/compiler'

/**
 * Prints the diagnostics of a file and reports whether any of them is an error.
 *
 * @param fileName Name of the file the diagnostics refer to.
 * @param diagnostics Diagnostics to print.
 * @returns Whether at least one diagnostic has `error` severity.
 */
export function reportDiagnostics(fileName: string, diagnostics: DiagnosticBag): boolean {
  for (const diagnostic of diagnostics.all) {
    const line = diagnostic.range.line + 1
    const column = diagnostic.range.column + 1

    console.error(
      `${fileName}:${String(line)}:${String(column)}: ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
    )
  }

  return diagnostics.hasErrors
}
