import * as ts from 'typescript'

import { type DiagnosticBag } from '../shared/diagnostics/bag.js'
import { type Diagnostic, toDiagnosticSeverity } from '../shared/diagnostics/diagnostic.js'

/** Options that configure a parser. */
export interface ParserOptions {
  /** File name attached to the syntax tree. Defaults to `source.shift`. */
  readonly fileName?: string
  /** Language version used to parse the source. Defaults to `ScriptTarget.Latest`. */
  readonly languageVersion?: ts.ScriptTarget
  /** Script kind that selects the parsing dialect. Defaults to `ScriptKind.TS`. */
  readonly scriptKind?: ts.ScriptKind
}

const defaultFileName = 'source.shift'

/**
 * Source files expose their parse diagnostics at runtime, but TypeScript does not declare them
 * in its public types.
 */
interface ParsedSourceFile extends ts.SourceFile {
  readonly parseDiagnostics?: readonly ts.Diagnostic[]
}

/**
 * Parses Shift source text into a TypeScript syntax tree.
 */
export class Parser {
  private readonly _fileName: string
  private readonly _languageVersion: ts.ScriptTarget
  private readonly _scriptKind: ts.ScriptKind

  /**
   * @param options Parser options. The defaults use the `source.shift` file name and the latest
   * language version.
   */
  public constructor(options: ParserOptions = {}) {
    this._fileName = options.fileName ?? defaultFileName
    this._languageVersion = options.languageVersion ?? ts.ScriptTarget.Latest
    this._scriptKind = options.scriptKind ?? ts.ScriptKind.TS
  }

  /**
   * Builds a source file with parent nodes linked so the tree can be traversed directly.
   *
   * @param source Shift source text.
   * @param diagnostics Bag that collects syntax errors found while parsing.
   * @returns Parsed source file.
   */
  public parse(source: string, diagnostics: DiagnosticBag): ts.SourceFile {
    const sourceFile = ts.createSourceFile(
      this._fileName,
      source,
      this._languageVersion,
      true,
      this._scriptKind,
    )
    const parsed = sourceFile as ParsedSourceFile

    for (const diagnostic of parsed.parseDiagnostics ?? []) {
      diagnostics.add(toDiagnostic(sourceFile, diagnostic))
    }

    return sourceFile
  }
}

/**
 * Converts a TypeScript diagnostic into a shared diagnostic.
 *
 * @param sourceFile Source file the diagnostic refers to.
 * @param diagnostic Diagnostic reported by TypeScript.
 * @returns Shared diagnostic with a resolved source range.
 */
function toDiagnostic(sourceFile: ts.SourceFile, diagnostic: ts.Diagnostic): Diagnostic {
  const start = diagnostic.start ?? 0
  const end = start + (diagnostic.length ?? 0)
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start)

  return {
    code: String(diagnostic.code),
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    severity: toDiagnosticSeverity(diagnostic.category),
    range: { start, end, line, column: character },
  }
}
