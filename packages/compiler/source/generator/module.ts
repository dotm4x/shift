import { type FunctionSignature, LlvmFunction } from './function.js'
import { formatStringBytes, type LlvmGlobal, type StringBytes } from './values.js'

interface StringEntry {
  readonly bytes: StringBytes
  readonly global: LlvmGlobal
}

/**
 * A module of LLVM IR awaiting emission.
 */
export class LlvmModule {
  private readonly _declarations: string[] = []
  private readonly _declared: Set<string> = new Set<string>()
  private readonly _functions: LlvmFunction[] = []
  private readonly _strings: Map<string, StringEntry> = new Map<string, StringEntry>()
  private readonly _stringLengths: Map<string, number> = new Map<string, number>()
  private _stringCounter: number = 0

  /**
   * Adds a function to the module.
   *
   * @param signature Signature of the function.
   * @param parameterNames Names of the parameters.
   * @returns Builder of the function body.
   */
  public addFunction(
    signature: FunctionSignature,
    parameterNames: readonly string[],
  ): LlvmFunction {
    const added = new LlvmFunction(signature, parameterNames)
    this._functions.push(added)

    return added
  }

  /**
   * Declares an external function, such as one provided by libc.
   *
   * @param line Declaration line, for example `declare i32 @printf(ptr, ...)`.
   */
  public addDeclaration(line: string): void {
    if (this._declared.has(line)) {
      return
    }

    this._declared.add(line)
    this._declarations.push(line)
  }

  /**
   * Returns a pointer to the global constant of a string, interning equal strings.
   *
   * @param value Contents of the string.
   * @returns Global of the string constant.
   */
  public addStringLiteral(value: string): LlvmGlobal {
    const existing = this._strings.get(value)

    if (existing !== undefined) {
      return existing.global
    }

    const global: LlvmGlobal = { kind: 'global', name: `.str.${String(this._stringCounter)}` }
    this._stringCounter++
    const bytes = formatStringBytes(value)
    this._strings.set(value, { bytes, global })
    this._stringLengths.set(global.name, bytes.length)

    return global
  }

  /**
   * Returns the byte length of the global constant of a string, including the terminator.
   *
   * @param global Global of the string constant.
   * @returns Byte length of the constant.
   */
  public stringLength(global: LlvmGlobal): number {
    const length = this._stringLengths.get(global.name)

    if (length === undefined) {
      throw new Error(`Unknown string global '${global.name}'.`)
    }

    return length
  }

  /**
   * Renders the module as LLVM IR text.
   *
   * @returns LLVM IR text of the module.
   */
  public emit(): string {
    const parts: string[] = []

    for (const entry of this._strings.values()) {
      parts.push(
        `@${entry.global.name} = private unnamed_addr constant [${String(entry.bytes.length)} x i8] c"${entry.bytes.text}"`,
      )
    }

    for (const declaration of this._declarations) {
      parts.push(declaration)
    }

    for (const added of this._functions) {
      parts.push(added.emit())
    }

    return `${parts.join('\n\n')}\n`
  }
}
