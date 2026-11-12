import * as ts from 'typescript'

import { type Builtin, defaultBuiltins } from '../shared/builtins.js'
import { type DiagnosticBag } from '../shared/diagnostics/bag.js'
import type { SourceRange } from '../shared/position.js'

import { Scope, type ScopeKind } from './scope.js'
import { Symbol } from './symbol.js'
import { builtinTypeNames } from './types/type.js'

/** Options that configure an analyzer. */
export interface AnalyzerOptions {
  /** Functions provided by the language. Defaults to the built-in functions. */
  readonly builtins?: readonly Builtin[]
  /** Names available in the global scope without being declared. Defaults to no globals. */
  readonly globals?: readonly string[] | undefined
}

/**
 * Builds the scope and symbol model of a syntax tree and reports semantic errors.
 */
export class Analyzer {
  private readonly _builtins: readonly Builtin[]
  private readonly _globals: ReadonlySet<string>

  /**
   * @param options Analyzer options. The defaults treat every undeclared name as an error and
   * provide the built-in functions.
   */
  public constructor(options: AnalyzerOptions = {}) {
    this._builtins = options.builtins ?? defaultBuiltins
    this._globals = new Set(options.globals ?? [])
  }

  /**
   * Analyzes the given syntax tree. The tree should have parent nodes linked, as produced by the
   * parser.
   *
   * @param sourceFile Syntax tree to analyze.
   * @param diagnostics Bag that collects the semantic errors found.
   * @returns The global scope holding every top-level symbol.
   */
  public analyze(sourceFile: ts.SourceFile, diagnostics: DiagnosticBag): Scope {
    const context: CollectionContext = {
      builtins: new Set<string>(this._builtins.map((builtin) => builtin.name)),
      diagnostics,
      globals: this._globals,
      references: [],
      scopes: [],
      sourceFile,
      typeReferences: [],
    }
    const globalScope = new Scope('global', undefined)
    context.scopes.push(globalScope)

    for (const builtin of this._builtins) {
      globalScope.add(new Symbol(builtin.name, 'function', undefined, false))
    }

    this.collect(sourceFile, globalScope, context)
    this.resolveReferences(context)
    this.resolveTypeReferences(context)
    this.reportUnusedSymbols(context)

    return globalScope
  }

  /**
   * Walks the tree, building the scope tree and collecting declarations and references.
   */
  private collect(node: ts.Node, scope: Scope, context: CollectionContext): void {
    const childScope = this.enterScope(node, scope, context)
    const current = childScope ?? scope

    this.collectDeclaration(node, scope, current, context)

    if (isReference(node)) {
      context.references.push({ identifier: node, scope: current })
    } else if (isTypeReference(node)) {
      context.typeReferences.push({ identifier: node, scope: current })
    }

    ts.forEachChild(node, (child) => {
      this.collect(child, current, context)
    })
  }

  /**
   * Creates the scope that the given node opens, if any.
   */
  private enterScope(node: ts.Node, parent: Scope, context: CollectionContext): Scope | undefined {
    const kind = scopeKindOf(node)

    if (kind === undefined) {
      return undefined
    }

    const childScope = new Scope(kind, parent)
    context.scopes.push(childScope)

    return childScope
  }

  /**
   * Declares the symbol introduced by the given node, if any.
   */
  private collectDeclaration(
    node: ts.Node,
    enclosing: Scope,
    current: Scope,
    context: CollectionContext,
  ): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const list = node.parent
      const blockScoped =
        ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.BlockScoped) !== 0

      this.declareSymbol(
        current,
        new Symbol(node.name.text, 'variable', node, blockScoped),
        context,
      )

      return
    }

    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      this.declareSymbol(enclosing, new Symbol(node.name.text, 'function', node, false), context)

      return
    }

    if (ts.isClassDeclaration(node) && node.name !== undefined) {
      this.declareSymbol(enclosing, new Symbol(node.name.text, 'class', node, true), context)

      return
    }

    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      this.declareSymbol(current, new Symbol(node.name.text, 'parameter', node, false), context)

      return
    }

    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      this.declareSymbol(current, new Symbol('this', 'this', undefined, false), context)

      return
    }

    if (ts.isTypeAliasDeclaration(node)) {
      this.declareSymbol(enclosing, new Symbol(node.name.text, 'type', node, true), context)

      return
    }

    if (ts.isInterfaceDeclaration(node)) {
      this.declareSymbol(enclosing, new Symbol(node.name.text, 'interface', node, true), context)

      return
    }

    if (ts.isEnumDeclaration(node)) {
      this.declareSymbol(enclosing, new Symbol(node.name.text, 'enum', node, true), context)

      return
    }

    if (ts.isTypeParameterDeclaration(node) && ts.isIdentifier(node.name)) {
      this.declareSymbol(current, new Symbol(node.name.text, 'typeParameter', node, true), context)
    }
  }

  /**
   * Adds a symbol to its scope and reports duplicated declarations.
   */
  private declareSymbol(scope: Scope, symbol: Symbol, context: CollectionContext): void {
    const existing = scope.add(symbol)

    if (existing === undefined) {
      return
    }

    if (symbol.blockScoped || existing.blockScoped) {
      context.diagnostics.add({
        code: 'no-duplicate-declaration',
        message: `Identifier '${symbol.name}' is already declared.`,
        severity: 'error',
        range:
          symbol.declaration === undefined
            ? { start: 0, end: 0, line: 0, column: 0 }
            : rangeOf(symbol.declaration, context.sourceFile),
      })
    }
  }

  /**
   * Resolves every collected reference against its scope chain.
   */
  private resolveReferences(context: CollectionContext): void {
    for (const { identifier, scope } of context.references) {
      const symbol = scope.resolve(identifier.text)

      if (symbol === undefined) {
        if (!context.globals.has(identifier.text)) {
          context.diagnostics.add({
            code: 'no-undeclared-reference',
            message: `Identifier '${identifier.text}' is not declared.`,
            severity: 'error',
            range: rangeOf(identifier, context.sourceFile),
          })
        }

        continue
      }

      symbol.addReference(identifier)
    }
  }

  /**
   * Resolves every collected type reference against its scope chain.
   */
  private resolveTypeReferences(context: CollectionContext): void {
    for (const { identifier, scope } of context.typeReferences) {
      const symbol = scope.resolve(identifier.text)

      if (symbol === undefined || !isTypeSymbol(symbol)) {
        if (!context.globals.has(identifier.text) && !builtinTypeNames.has(identifier.text)) {
          context.diagnostics.add({
            code: 'no-undeclared-type',
            message: `Type '${identifier.text}' is not declared.`,
            severity: 'error',
            range: rangeOf(identifier, context.sourceFile),
          })
        }

        continue
      }

      symbol.addReference(identifier)
    }
  }

  /**
   * Reports every declared symbol that was never referenced.
   */
  private reportUnusedSymbols(context: CollectionContext): void {
    for (const scope of context.scopes) {
      for (const symbol of scope.symbols) {
        if (
          symbol.used ||
          symbol.declaration === undefined ||
          symbol.kind === 'this' ||
          context.builtins.has(symbol.name)
        ) {
          continue
        }

        context.diagnostics.add({
          code: 'no-unused-variable',
          message: `Identifier '${symbol.name}' is declared but never used.`,
          severity: 'warning',
          range: rangeOf(symbol.declaration, context.sourceFile),
        })
      }
    }
  }
}

/**
 * Returns the kind of scope the given node opens, if any.
 */
function scopeKindOf(node: ts.Node): ScopeKind | undefined {
  if (ts.isFunctionLike(node)) {
    return 'function'
  }

  if (
    (ts.isBlock(node) && !ts.isFunctionLike(node.parent)) ||
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isCatchClause(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isClassDeclaration(node)
  ) {
    return 'block'
  }

  return undefined
}

/**
 * Determines whether the given node is a value reference.
 */
function isReference(node: ts.Node): node is ts.Identifier {
  if (!ts.isIdentifier(node)) {
    return false
  }

  const parent = node.parent

  return !(
    isDeclarationName(node, parent) ||
    isMemberName(node, parent) ||
    isTypePosition(node, parent) ||
    isLabel(node, parent)
  )
}

/**
 * Determines whether the identifier is the name of a declaration or member.
 */
function isDeclarationName(node: ts.Identifier, parent: ts.Node): boolean {
  return (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionExpression(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isTypeAliasDeclaration(parent) && parent.name === node) ||
    (ts.isInterfaceDeclaration(parent) && parent.name === node) ||
    (ts.isEnumDeclaration(parent) && parent.name === node) ||
    (ts.isEnumMember(parent) && parent.name === node) ||
    (ts.isModuleDeclaration(parent) && parent.name === node) ||
    (ts.isTypeParameterDeclaration(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isMethodSignature(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isGetAccessorDeclaration(parent) && parent.name === node) ||
    (ts.isSetAccessorDeclaration(parent) && parent.name === node) ||
    (ts.isImportSpecifier(parent) && parent.name === node) ||
    (ts.isExportSpecifier(parent) && parent.name === node)
  )
}

/**
 * Determines whether the identifier names a member of another value.
 */
function isMemberName(node: ts.Identifier, parent: ts.Node): boolean {
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isQualifiedName(parent) && parent.right === node)
  )
}

/**
 * Determines whether the identifier is used in a type position.
 */
function isTypePosition(node: ts.Identifier, parent: ts.Node): boolean {
  return ts.isTypeReferenceNode(parent) && parent.typeName === node
}

/**
 * Determines whether the identifier names a type.
 */
function isTypeReference(node: ts.Node): node is ts.Identifier {
  return (
    ts.isIdentifier(node) && ts.isTypeReferenceNode(node.parent) && node.parent.typeName === node
  )
}

/**
 * Determines whether the symbol can be used as a type.
 */
function isTypeSymbol(symbol: Symbol): boolean {
  return (
    symbol.kind === 'type' ||
    symbol.kind === 'interface' ||
    symbol.kind === 'enum' ||
    symbol.kind === 'class' ||
    symbol.kind === 'typeParameter'
  )
}

/**
 * Determines whether the identifier is a statement label.
 */
function isLabel(node: ts.Identifier, parent: ts.Node): boolean {
  return (
    (ts.isLabeledStatement(parent) && parent.label === node) ||
    (ts.isBreakStatement(parent) && parent.label === node) ||
    (ts.isContinueStatement(parent) && parent.label === node)
  )
}

/**
 * Builds the source range of a node.
 */
function rangeOf(node: ts.Node, sourceFile: ts.SourceFile): SourceRange {
  const start = node.getStart(sourceFile)
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start)

  return { start, end: node.getEnd(), line, column: character }
}

/**
 * State shared while collecting a single syntax tree.
 */
interface CollectionContext {
  readonly builtins: ReadonlySet<string>
  readonly diagnostics: DiagnosticBag
  readonly globals: ReadonlySet<string>
  readonly references: Reference[]
  readonly scopes: Scope[]
  readonly sourceFile: ts.SourceFile
  readonly typeReferences: TypeReference[]
}

/**
 * A value reference collected before being resolved.
 */
interface Reference {
  readonly identifier: ts.Identifier
  readonly scope: Scope
}

/**
 * A type reference collected before being resolved.
 */
interface TypeReference {
  readonly identifier: ts.Identifier
  readonly scope: Scope
}
