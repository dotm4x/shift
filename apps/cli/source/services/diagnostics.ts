import { readFileSync } from 'node:fs'

import { CompilerError, type Diagnostic, type DiagnosticBag } from '@livescript/compiler'

/** ANSI color codes used by the renderer. */
const colors = {
  bold: '\u001b[1m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  cyan: '\u001b[36m',
  reset: '\u001b[0m',
}

/**
 * Reads the line of a file that a diagnostic refers to.
 *
 * @param file Path of the source file.
 * @param line Zero-based line of the diagnostic.
 * @returns The line text, or `undefined` when the file cannot be read.
 */
function sourceLineOf(file: string, line: number): string | undefined {
  try {
    return readFileSync(file, 'utf8').split('\n')[line]
  } catch {
    return undefined
  }
}

/**
 * Renders a diagnostic in the style of the Rust compiler.
 *
 * @param file Path of the source file.
 * @param diagnostic Diagnostic to render.
 * @returns Rendered text, without a trailing newline.
 */
export function renderDiagnostic(file: string, diagnostic: Diagnostic): string {
  const line = diagnostic.range.line + 1
  const column = diagnostic.range.column + 1
  const severity =
    diagnostic.severity === 'error'
      ? `${colors.bold}${colors.red}error${colors.reset}`
      : `${colors.bold}${colors.yellow}warning${colors.reset}`
  const code = `${colors.blue}[${diagnostic.code}]${colors.reset}`
  const lines: string[] = []

  lines.push(`${severity}: ${diagnostic.message} ${code}`)
  lines.push(`  ${colors.blue}-->${colors.reset} ${file}:${String(line)}:${String(column)}`)

  const source = sourceLineOf(file, diagnostic.range.line)

  if (source !== undefined) {
    const gutter = String(line).length
    const caret = `${' '.repeat(diagnostic.range.column)}${'^'.repeat(Math.max(diagnostic.range.end - diagnostic.range.start, 1))}`
    const color = diagnostic.severity === 'error' ? colors.red : colors.yellow

    lines.push(`${' '.repeat(gutter)} ${colors.blue}|${colors.reset}`)
    lines.push(`${String(line)} ${colors.blue}|${colors.reset} ${source}`)
    lines.push(
      `${' '.repeat(gutter)} ${colors.blue}|${colors.reset} ${color}${caret}${colors.reset}`,
    )
  }

  if (diagnostic.hint !== undefined) {
    lines.push(`  ${colors.bold}${colors.cyan}hint:${colors.reset} ${diagnostic.hint}`)
  }

  return lines.join('\n')
}

/**
 * Converts a compiler error into a diagnostic.
 *
 * @param file Path of the source file.
 * @param error Compiler error to convert.
 * @returns Diagnostic with a resolved source range.
 */
function diagnosticOfError(error: CompilerError): Diagnostic {
  const node = error.node
  const sourceFile = node?.getSourceFile()
  const start = node === undefined ? 0 : node.getStart(sourceFile)
  const end = node === undefined ? start : node.getEnd()
  const position =
    sourceFile === undefined
      ? { line: 0, character: 0 }
      : sourceFile.getLineAndCharacterOfPosition(start)

  const diagnostic: Diagnostic = {
    code: error.code,
    message: error.message,
    severity: 'error',
    range: { start, end, line: position.line, column: position.character },
  }

  if (error.hint !== undefined) {
    return { ...diagnostic, hint: error.hint }
  }

  return diagnostic
}

/**
 * Prints the diagnostics of a file and reports whether any of them is an error.
 *
 * @param fileName Name of the file the diagnostics refer to.
 * @param diagnostics Diagnostics to print.
 * @returns Whether at least one diagnostic has `error` severity.
 */
export function reportDiagnostics(fileName: string, diagnostics: DiagnosticBag): boolean {
  for (const diagnostic of diagnostics.all) {
    console.error(renderDiagnostic(fileName, diagnostic))
  }

  return diagnostics.hasErrors
}

/**
 * Prints a compiler error that is not attached to a node.
 *
 * @param error Error to print.
 */
export function reportError(file: string, error: unknown): void {
  if (error instanceof CompilerError) {
    console.error(renderDiagnostic(file, diagnosticOfError(error)))

    return
  }

  console.error(error instanceof Error ? error.message : error)
}
