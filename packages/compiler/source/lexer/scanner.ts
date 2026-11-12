import { reservedWords, type Token, tokenKinds, type TokenKind as TokenKindType } from './token.js'

/** Callback that receives the details of a scan error. */
export type ScanErrorListener = (code: string, message: string, start: number, end: number) => void

/** Options that configure a scanner. */
export interface ScannerOptions {
  /** Whether whitespace and comments are skipped. Defaults to `true`. */
  readonly skipTrivia?: boolean
}

/** Single-line and multi-line comment openers, and template substitution handling. */
const identifierStart = /[\p{L}\p{Nl}$_]/u
const identifierPart = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$_]/u

/**
 * Scans Shift source text into tokens without any external compiler API.
 *
 * The scanner tracks template substitution nesting so a `}` closes a substitution only when it
 * does not close an inner block first.
 */
export class Scanner {
  private readonly _source: string
  private readonly _skipTrivia: boolean
  private readonly _onError: ScanErrorListener
  private readonly _templateStack: number[] = []

  private _position: number = 0
  private _tokenStart: number = 0
  private _tokenEnd: number = 0
  private _tokenKind: TokenKindType = tokenKinds.endOfFile
  private _tokenValue: string = ''

  /**
   * @param source Source text to scan.
   * @param onError Listener that receives scan errors.
   * @param options Scanner options. The defaults skip whitespace and comments.
   */
  public constructor(source: string, onError: ScanErrorListener, options: ScannerOptions = {}) {
    this._source = source
    this._onError = onError
    this._skipTrivia = options.skipTrivia ?? true
  }

  /**
   * Returns the current character without consuming it, or the empty string at the end.
   */
  private get currentCharacter(): string {
    return this._source[this._position] ?? ''
  }

  /**
   * Scans the next token.
   *
   * @returns The scanned token. Repeated calls after the end of the file keep returning the
   * end-of-file token.
   */
  public scan(): Token {
    this._tokenStart = this._position
    this._tokenValue = ''

    if (this._position >= this._source.length) {
      return this.finish(tokenKinds.endOfFile)
    }

    if (this._skipTrivia) {
      this.skipTrivia()
      this._tokenStart = this._position

      if (this._position >= this._source.length) {
        return this.finish(tokenKinds.endOfFile)
      }
    }

    if (
      this._templateStack.length > 0 &&
      this._templateStack.at(-1) === 0 &&
      this.currentCharacter === '}'
    ) {
      this._templateStack.pop()

      return this.scanTemplateContinuation()
    }

    return this.scanToken()
  }

  /**
   * Returns the character at a given offset, or the empty string past the end.
   */
  private characterAt(offset: number): string {
    return this._source[offset] ?? ''
  }

  /**
   * Skips whitespace and comments, reporting unterminated block comments.
   */
  private skipTrivia(): void {
    while (this._position < this._source.length) {
      const character = this.currentCharacter

      if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
        this._position += 1
        continue
      }

      if (character === '/' && this.characterAt(this._position + 1) === '/') {
        this._position = this.endOfLineFrom(this._position + 2)
        continue
      }

      if (character === '/' && this.characterAt(this._position + 1) === '*') {
        this.skipBlockComment()
        continue
      }

      return
    }
  }

  /**
   * Skips a block comment starting at the current position.
   */
  private skipBlockComment(): void {
    const start = this._position
    const end = this._source.indexOf('*/', this._position + 2)

    if (end === -1) {
      this._position = this._source.length
      this.reportError(
        'no-unterminated-comment',
        'Unterminated multi-line comment.',
        start,
        this._source.length,
      )

      return
    }

    this._position = end + 2
  }

  /**
   * Scans a single token, including trivia tokens when they are not skipped.
   */
  private scanToken(): Token {
    const character = this.currentCharacter

    if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
      return this.scanWhitespace()
    }

    if (character === '/' && this.characterAt(this._position + 1) === '/') {
      return this.scanSingleLineComment()
    }

    if (character === '/' && this.characterAt(this._position + 1) === '*') {
      return this.scanMultiLineComment()
    }

    if (character === '`') {
      return this.scanTemplate()
    }

    if (character === '"' || character === "'") {
      return this.scanStringLiteral(character)
    }

    if (identifierStart.test(character)) {
      return this.scanIdentifier()
    }

    if (/[0-9]/.test(character)) {
      return this.scanNumericLiteral()
    }

    return this.scanOperator()
  }

  /**
   * Scans a run of whitespace characters.
   */
  private scanWhitespace(): Token {
    while (this._position < this._source.length) {
      const character = this.currentCharacter

      if (character !== ' ' && character !== '\t' && character !== '\n' && character !== '\r') {
        break
      }

      this._position += 1
    }

    return this.finish(tokenKinds.whitespaceTrivia)
  }

  /**
   * Scans a single-line comment.
   */
  private scanSingleLineComment(): Token {
    this._position = this.endOfLineFrom(this._position + 2)

    return this.finish(tokenKinds.singleLineCommentTrivia)
  }

  /**
   * Scans a multi-line comment, reporting an unterminated comment.
   */
  private scanMultiLineComment(): Token {
    const start = this._position
    const end = this._source.indexOf('*/', this._position + 2)

    if (end === -1) {
      this._position = this._source.length
      this.reportError(
        'no-unterminated-comment',
        'Unterminated multi-line comment.',
        start,
        this._source.length,
      )

      return this.finish(tokenKinds.multiLineCommentTrivia)
    }

    this._position = end + 2

    return this.finish(tokenKinds.multiLineCommentTrivia)
  }

  /**
   * Returns the offset where the line that contains `from` ends, excluding the line break.
   */
  private endOfLineFrom(from: number): number {
    let offset = from

    while (offset < this._source.length) {
      const character = this._source[offset]

      if (character === '\n' || character === '\r') {
        return offset
      }

      offset += 1
    }

    return this._source.length
  }

  /**
   * Scans an identifier or a reserved keyword.
   */
  private scanIdentifier(): Token {
    let end = this._position + 1

    while (end < this._source.length && identifierPart.test(this.characterAt(end))) {
      end += 1
    }

    const text = this._source.slice(this._position, end)
    this._position = end

    const kind = reservedWords.has(text) ? keywordKindOf(text) : tokenKinds.identifier

    return this.finish(kind, text)
  }

  /**
   * Scans a numeric literal, including radix prefixes and the bigint suffix.
   */
  private scanNumericLiteral(): Token {
    const start = this._position
    let end = this._position

    if (this.characterAt(end) === '0' && /[xXbBoO]/.test(this.characterAt(end + 1))) {
      const radix = this.characterAt(end + 1).toLowerCase() === 'x' ? /[0-9a-fA-F_]/ : /[0-9_]/
      end += 2

      while (end < this._source.length && radix.test(this.characterAt(end))) {
        end += 1
      }

      if (end === start + 2) {
        this.reportError('no-invalid-number', 'Invalid number literal.', start, end)
      }
    } else {
      while (end < this._source.length && /[0-9_]/.test(this.characterAt(end))) {
        end += 1
      }

      if (this.characterAt(end) === '.') {
        end += 1

        while (end < this._source.length && /[0-9_]/.test(this.characterAt(end))) {
          end += 1
        }
      }

      if (/[eE]/.test(this.characterAt(end))) {
        let exponentEnd = end + 1

        if (/[+-]/.test(this.characterAt(exponentEnd))) {
          exponentEnd += 1
        }

        if (/[0-9]/.test(this.characterAt(exponentEnd))) {
          end = exponentEnd

          while (end < this._source.length && /[0-9_]/.test(this.characterAt(end))) {
            end += 1
          }
        }
      }
    }

    if (this.characterAt(end) === 'n') {
      end += 1
    }

    this._position = end

    return this.finish(tokenKinds.numericLiteral)
  }

  /**
   * Scans a single- or double-quoted string literal, decoding escape sequences.
   */
  private scanStringLiteral(quote: string): Token {
    const start = this._position
    let end = this._position + 1
    let value = ''
    let terminated = false

    while (end < this._source.length) {
      const character = this._source[end] ?? ''

      if (character === quote) {
        end += 1
        terminated = true

        break
      }

      if (character === '\n' || character === '\r') {
        break
      }

      if (character === '\\') {
        const decoded = this.decodeEscape(end)

        if (decoded === undefined) {
          this.reportError(
            'no-invalid-escape-sequence',
            'Invalid escape sequence.',
            end,
            Math.min(end + 2, this._source.length),
          )
          end += 2

          continue
        }

        value += decoded.text
        end = decoded.end

        continue
      }

      value += character
      end += 1
    }

    if (!terminated) {
      this.reportError('no-unterminated-string', 'Unterminated string literal.', start, end)
    }

    this._position = end

    return this.finish(tokenKinds.stringLiteral, value)
  }

  /**
   * Decodes the escape sequence that starts at `offset`.
   *
   * @returns The decoded text and the offset after the sequence, or `undefined` when invalid.
   */
  private decodeEscape(
    offset: number,
  ): { readonly text: string; readonly end: number } | undefined {
    const escape = this.characterAt(offset + 1)

    switch (escape) {
      case 'n':
        return { text: '\n', end: offset + 2 }
      case 't':
        return { text: '\t', end: offset + 2 }
      case 'r':
        return { text: '\r', end: offset + 2 }
      case 'b':
        return { text: '\b', end: offset + 2 }
      case 'f':
        return { text: '\f', end: offset + 2 }
      case 'v':
        return { text: '\v', end: offset + 2 }
      case '0':
        return { text: '\0', end: offset + 2 }
      case "'":
        return { text: "'", end: offset + 2 }
      case '"':
        return { text: '"', end: offset + 2 }
      case '`':
        return { text: '`', end: offset + 2 }
      case '\\':
        return { text: '\\', end: offset + 2 }
      case '\n':
        return { text: '', end: offset + 2 }
      case 'x': {
        const digits = this._source.slice(offset + 2, offset + 4)

        if (!/^[0-9a-fA-F]{2}$/.test(digits)) {
          return undefined
        }

        return { text: String.fromCharCode(Number.parseInt(digits, 16)), end: offset + 4 }
      }

      case 'u': {
        if (this.characterAt(offset + 2) === '{') {
          const closing = this._source.indexOf('}', offset + 3)

          if (closing === -1) {
            return undefined
          }

          const digits = this._source.slice(offset + 3, closing)

          if (!/^[0-9a-fA-F]+$/.test(digits) || digits.length > 6) {
            return undefined
          }

          return { text: String.fromCodePoint(Number.parseInt(digits, 16)), end: closing + 1 }
        }

        const digits = this._source.slice(offset + 2, offset + 6)

        if (!/^[0-9a-fA-F]{4}$/.test(digits)) {
          return undefined
        }

        return { text: String.fromCharCode(Number.parseInt(digits, 16)), end: offset + 6 }
      }

      default:
        return undefined
    }
  }

  /**
   * Scans a template literal head, middle, or tail.
   */
  private scanTemplate(): Token {
    const start = this._position
    let end = this._position + 1
    let value = ''

    while (end < this._source.length) {
      const character = this._source[end] ?? ''

      if (character === '`') {
        this._position = end + 1

        return this.finish(tokenKinds.templateTail, value)
      }

      if (character === '\\' && end + 1 >= this._source.length) {
        break
      }

      if (character === '\\') {
        const decoded = this.decodeEscape(end)

        if (decoded === undefined) {
          this.reportError(
            'no-invalid-escape-sequence',
            'Invalid escape sequence.',
            end,
            Math.min(end + 2, this._source.length),
          )
          end += 2

          continue
        }

        value += decoded.text
        end = decoded.end

        continue
      }

      if (character === '$' && this.characterAt(end + 1) === '{') {
        this._position = end + 2
        this._templateStack.push(0)

        return this.finish(tokenKinds.templateHead, value)
      }

      if (character === '\n' || character === '\r') {
        value += character
        end += 1

        continue
      }

      value += character
      end += 1
    }

    this._position = this._source.length
    this.reportError(
      'no-unterminated-template',
      'Unterminated template literal.',
      start,
      this._source.length,
    )

    return this.finish(tokenKinds.invalidTemplateTail, value)
  }

  /**
   * Scans a template continuation after a substitution closes.
   */
  private scanTemplateContinuation(): Token {
    const start = this._position
    let end = this._position + 1
    let value = ''

    while (end < this._source.length) {
      const character = this._source[end] ?? ''

      if (character === '`') {
        this._position = end + 1

        return this.finish(tokenKinds.templateTail, value)
      }

      if (character === '\\') {
        const decoded = this.decodeEscape(end)

        if (decoded === undefined) {
          this.reportError(
            'no-invalid-escape-sequence',
            'Invalid escape sequence.',
            end,
            Math.min(end + 2, this._source.length),
          )
          end += 2

          continue
        }

        value += decoded.text
        end = decoded.end

        continue
      }

      if (character === '$' && this.characterAt(end + 1) === '{') {
        this._position = end + 2
        this._templateStack.push(0)

        return this.finish(tokenKinds.templateMiddle, value)
      }

      if (character === '\n' || character === '\r') {
        value += character
        end += 1

        continue
      }

      value += character
      end += 1
    }

    this._position = this._source.length
    this.reportError(
      'no-unterminated-template',
      'Unterminated template literal.',
      start,
      this._source.length,
    )

    return this.finish(tokenKinds.invalidTemplateTail, value)
  }

  /**
   * Scans an operator or punctuator.
   */
  private scanOperator(): Token {
    const start = this._position
    const three = this._source.slice(start, start + 3)
    const two = this._source.slice(start, start + 2)
    const one = this._source.slice(start, start + 1)

    const threeKind = operatorKinds.get(three)

    if (threeKind !== undefined) {
      this._position = start + 3

      return this.finish(threeKind)
    }

    const twoKind = operatorKinds.get(two)

    if (twoKind !== undefined) {
      this._position = start + 2

      return this.finish(twoKind)
    }

    const oneKind = operatorKinds.get(one)

    if (oneKind !== undefined) {
      this._position = start + 1
      this.trackTemplateBraces(oneKind)

      return this.finish(oneKind)
    }

    this._position = start + 1
    this.reportError('no-invalid-character', `Invalid character '${one}'.`, start, start + 1)

    return this.finish(tokenKinds.invalidCharacter)
  }

  /**
   * Tracks brace nesting inside template substitutions, so a `}` closes the substitution only
   * after every inner block has been closed.
   */
  private trackTemplateBraces(kind: TokenKindType): void {
    if (this._templateStack.length === 0) {
      return
    }

    const index = this._templateStack.length - 1

    if (kind === tokenKinds.openBraceToken) {
      this._templateStack[index] = (this._templateStack[index] ?? 0) + 1

      return
    }

    if (kind === tokenKinds.closeBraceToken && (this._templateStack[index] ?? 0) > 0) {
      this._templateStack[index] = (this._templateStack[index] ?? 0) - 1
    }
  }

  /**
   * Builds the token that was scanned between the tracked offsets.
   */
  private finish(kind: TokenKindType, value?: string): Token {
    this._tokenEnd = this._position
    this._tokenKind = kind
    this._tokenValue = value ?? this._source.slice(this._tokenStart, this._tokenEnd)

    return {
      kind,
      text: this._source.slice(this._tokenStart, this._tokenEnd),
      value: this._tokenValue,
      start: this._tokenStart,
      end: this._tokenEnd,
      line: 0,
      column: 0,
    }
  }

  /**
   * Reports a scan error through the configured listener.
   */
  private reportError(code: string, message: string, start: number, end: number): void {
    this._onError(code, message, start, end)
  }
}

/**
 * Returns the keyword token kind of a reserved word.
 */
function keywordKindOf(text: string): TokenKindType {
  return keywordKinds.get(text) ?? tokenKinds.identifier
}

const keywordKinds = new Map<string, TokenKindType>([
  ['break', tokenKinds.breakKeyword],
  ['case', tokenKinds.caseKeyword],
  ['catch', tokenKinds.catchKeyword],
  ['class', tokenKinds.classKeyword],
  ['const', tokenKinds.constKeyword],
  ['continue', tokenKinds.continueKeyword],
  ['debugger', tokenKinds.debuggerKeyword],
  ['default', tokenKinds.defaultKeyword],
  ['delete', tokenKinds.deleteKeyword],
  ['do', tokenKinds.doKeyword],
  ['else', tokenKinds.elseKeyword],
  ['enum', tokenKinds.enumKeyword],
  ['export', tokenKinds.exportKeyword],
  ['extends', tokenKinds.extendsKeyword],
  ['false', tokenKinds.falseKeyword],
  ['finally', tokenKinds.finallyKeyword],
  ['for', tokenKinds.forKeyword],
  ['function', tokenKinds.functionKeyword],
  ['if', tokenKinds.ifKeyword],
  ['implements', tokenKinds.implementsKeyword],
  ['import', tokenKinds.importKeyword],
  ['in', tokenKinds.inKeyword],
  ['instanceof', tokenKinds.instanceofKeyword],
  ['interface', tokenKinds.interfaceKeyword],
  ['let', tokenKinds.letKeyword],
  ['new', tokenKinds.newKeyword],
  ['null', tokenKinds.nullKeyword],
  ['package', tokenKinds.packageKeyword],
  ['private', tokenKinds.privateKeyword],
  ['protected', tokenKinds.protectedKeyword],
  ['public', tokenKinds.publicKeyword],
  ['readonly', tokenKinds.readonlyKeyword],
  ['return', tokenKinds.returnKeyword],
  ['static', tokenKinds.staticKeyword],
  ['super', tokenKinds.superKeyword],
  ['switch', tokenKinds.switchKeyword],
  ['this', tokenKinds.thisKeyword],
  ['throw', tokenKinds.throwKeyword],
  ['true', tokenKinds.trueKeyword],
  ['try', tokenKinds.tryKeyword],
  ['typeof', tokenKinds.typeofKeyword],
  ['var', tokenKinds.varKeyword],
  ['void', tokenKinds.voidKeyword],
  ['while', tokenKinds.whileKeyword],
  ['with', tokenKinds.withKeyword],
  ['yield', tokenKinds.yieldKeyword],
])

const operatorKinds = new Map<string, TokenKindType>([
  ['...', tokenKinds.dotDotDotToken],
  ['?.', tokenKinds.questionDotToken],
  ['=>', tokenKinds.arrowToken],
  ['===', tokenKinds.equalsEqualsEqualsToken],
  ['!==', tokenKinds.exclamationEqualsEqualsToken],
  ['**=', tokenKinds.asteriskAsteriskEqualsToken],
  ['<<=', tokenKinds.lessThanLessThanEqualsToken],
  ['>>=', tokenKinds.greaterThanGreaterThanEqualsToken],
  ['&&=', tokenKinds.ampersandAmpersandEqualsToken],
  ['||=', tokenKinds.barBarEqualsToken],
  ['??=', tokenKinds.questionQuestionEqualsToken],
  ['**', tokenKinds.asteriskAsteriskToken],
  ['<<', tokenKinds.lessThanLessThanToken],
  ['>>', tokenKinds.greaterThanGreaterThanToken],
  ['==', tokenKinds.equalsEqualsToken],
  ['!=', tokenKinds.exclamationEqualsToken],
  ['<=', tokenKinds.lessThanEqualsToken],
  ['>=', tokenKinds.greaterThanEqualsToken],
  ['&&', tokenKinds.ampersandAmpersandToken],
  ['||', tokenKinds.barBarToken],
  ['??', tokenKinds.questionQuestionToken],
  ['++', tokenKinds.plusPlusToken],
  ['--', tokenKinds.minusMinusToken],
  ['+=', tokenKinds.plusEqualsToken],
  ['-=', tokenKinds.minusEqualsToken],
  ['*=', tokenKinds.asteriskEqualsToken],
  ['/=', tokenKinds.slashEqualsToken],
  ['%=', tokenKinds.percentEqualsToken],
  ['&=', tokenKinds.ampersandEqualsToken],
  ['|=', tokenKinds.barEqualsToken],
  ['^=', tokenKinds.caretEqualsToken],
  ['{', tokenKinds.openBraceToken],
  ['}', tokenKinds.closeBraceToken],
  ['(', tokenKinds.openParenthesisToken],
  [')', tokenKinds.closeParenthesisToken],
  ['[', tokenKinds.openBracketToken],
  [']', tokenKinds.closeBracketToken],
  [',', tokenKinds.commaToken],
  [';', tokenKinds.semicolonToken],
  [':', tokenKinds.colonToken],
  ['.', tokenKinds.dotToken],
  ['?', tokenKinds.questionToken],
  ['@', tokenKinds.atToken],
  ['<', tokenKinds.lessThanToken],
  ['>', tokenKinds.greaterThanToken],
  ['=', tokenKinds.equalsToken],
  ['!', tokenKinds.exclamationToken],
  ['+', tokenKinds.plusToken],
  ['-', tokenKinds.minusToken],
  ['*', tokenKinds.asteriskToken],
  ['/', tokenKinds.slashToken],
  ['%', tokenKinds.percentToken],
  ['~', tokenKinds.tildeToken],
  ['&', tokenKinds.ampersandToken],
  ['|', tokenKinds.barToken],
  ['^', tokenKinds.caretToken],
])
