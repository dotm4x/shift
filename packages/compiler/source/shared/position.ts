/** Zero-based line and character position inside a source text. */
export interface SourcePosition {
  /** Zero-based line index. */
  readonly line: number
  /** Zero-based character index within the line. */
  readonly character: number
}

/** Zero-based range inside a source text. */
export interface SourceRange {
  /** Zero-based offset of the first character. */
  readonly start: number
  /** Zero-based offset after the last character. */
  readonly end: number
  /** Zero-based line of the start offset. */
  readonly line: number
  /** Zero-based column of the start offset. */
  readonly column: number
}

/**
 * Returns the offset of the first character of every line. `\n`, `\r\n` and `\r` are recognized
 * as line breaks.
 *
 * @param source Source text to inspect.
 * @returns Line offsets in ascending order, starting with `0`.
 */
export function computeLineStarts(source: string): readonly number[] {
  const lineStarts: number[] = [0]

  for (let index = 0; index < source.length; index++) {
    const character = source[index]

    if (character === '\r') {
      if (source[index + 1] === '\n') {
        index++
      }

      lineStarts.push(index + 1)
    } else if (character === '\n') {
      lineStarts.push(index + 1)
    }
  }

  return lineStarts
}

/**
 * Converts a zero-based offset into a zero-based line and character position.
 *
 * @param offset Zero-based offset in the source text.
 * @param lineStarts Line offsets returned by {@link computeLineStarts}.
 * @returns Position of the given offset.
 */
export function getPositionAt(offset: number, lineStarts: readonly number[]): SourcePosition {
  if (lineStarts.length === 0) {
    return { line: 0, character: offset }
  }

  let low = 0
  let high = lineStarts.length - 1

  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2)
    const lineStart = lineStarts[middle] ?? 0

    if (lineStart <= offset) {
      low = middle
    } else {
      high = middle - 1
    }
  }

  return { line: low, character: offset - (lineStarts[low] ?? 0) }
}
