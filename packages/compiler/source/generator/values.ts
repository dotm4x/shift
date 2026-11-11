/** LLVM IR types used by the generator. */
export type LlvmType = 'double' | 'i1' | 'i32' | 'i8' | 'ptr' | 'void'

/** A register local to a function. */
export interface LlvmLocal {
  readonly kind: 'local'
  readonly name: string
}

/** A global symbol of the module. */
export interface LlvmGlobal {
  readonly kind: 'global'
  readonly name: string
}

/** A constant operand with its type and textual form. */
export interface LlvmConstant {
  readonly kind: 'constant'
  readonly type: LlvmType
  readonly text: string
}

/** Any operand that can appear in an instruction. */
export type LlvmOperand = LlvmConstant | LlvmGlobal | LlvmLocal

/** The escaped byte contents of a string constant, including the terminator. */
export interface StringBytes {
  readonly length: number
  readonly text: string
}

/**
 * Formats a number as an LLVM double literal.
 *
 * @param value Number to format.
 * @returns Textual form accepted by the LLVM assembler.
 */
export function formatDouble(value: number): string {
  if (!Number.isFinite(value)) {
    return doubleBits(value)
  }

  const text = String(value)

  if (text.includes('.')) {
    return text
  }

  const exponentIndex = text.search(/[eE]/)

  if (exponentIndex === -1) {
    return `${text}.0`
  }

  return `${text.slice(0, exponentIndex)}.0${text.slice(exponentIndex)}`
}

/**
 * Formats a boolean as an LLVM i1 literal.
 *
 * @param value Boolean to format.
 * @returns `1` or `0`.
 */
export function formatBoolean(value: boolean): string {
  return value ? '1' : '0'
}

/**
 * Formats a string as the byte contents of an LLVM constant, including the terminator.
 *
 * @param value String to format.
 * @returns Escaped bytes and their total length.
 */
export function formatStringBytes(value: string): StringBytes {
  let text = ''
  let length = 1

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0

    for (const byte of utf8Encode(codePoint)) {
      text += escapeByte(byte)
      length++
    }
  }

  return { length, text: `${text}\\00` }
}

/**
 * Encodes a code point as UTF-8 bytes.
 */
function utf8Encode(codePoint: number): number[] {
  if (codePoint <= 0x7f) {
    return [codePoint]
  }

  if (codePoint <= 0x7ff) {
    return [0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f)]
  }

  if (codePoint <= 0xffff) {
    return [0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f)]
  }

  return [
    0xf0 | (codePoint >> 18),
    0x80 | ((codePoint >> 12) & 0x3f),
    0x80 | ((codePoint >> 6) & 0x3f),
    0x80 | (codePoint & 0x3f),
  ]
}

/**
 * Escapes a byte for an LLVM constant, keeping printable characters as-is.
 */
function escapeByte(byte: number): string {
  if (byte >= 0x20 && byte <= 0x7e && byte !== 0x22 && byte !== 0x5c) {
    return String.fromCharCode(byte)
  }

  return `\\${byte.toString(16).padStart(2, '0').toUpperCase()}`
}

/**
 * Renders the IEEE 754 bits of a number as an LLVM hexadecimal literal.
 */
function doubleBits(value: number): string {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  let text = '0x'

  for (let index = 0; index < 8; index++) {
    text += view.getUint8(index).toString(16).padStart(2, '0')
  }

  return text
}
