import * as ts from 'typescript'

import type { Type } from '../analyzer/types/type.js'
import { type Builtin, defaultBuiltins } from '../shared/builtins.js'

import { type FunctionSignature, type LlvmFunction } from './function.js'
import { LlvmModule } from './module.js'
import { irKindFromType, irTypeFromKind, irTypeFromNode, type ValueKind } from './types.js'
import {
  formatBoolean,
  formatDouble,
  type LlvmConstant,
  type LlvmLocal,
  type LlvmOperand,
  type LlvmType,
} from './values.js'

/** Options that configure a generator. */
export interface GeneratorOptions {
  /** Functions provided by the language. Defaults to the built-in functions. */
  readonly builtins?: readonly Builtin[]
  /** Name of the entry function that runs the top-level statements. Defaults to `main`. */
  readonly entryName?: string
}

/** Result of generating an expression. */
interface ExpressionResult {
  readonly kind: ValueKind
  readonly operand: LlvmOperand
}

/** Stack slot of a generated variable. */
interface VariableSlot {
  readonly kind: ValueKind
  readonly pointer: LlvmLocal
  readonly type: LlvmType
}

/** Labels of the loop being generated. */
interface LoopContext {
  readonly breakLabel: string
  readonly continueLabel: string
}

/** State shared while generating a single syntax tree. */
interface GenerationContext {
  readonly builtins: Map<string, Builtin>
  readonly entryName: string
  readonly functions: Map<string, FunctionSignature>
  readonly module: LlvmModule
  readonly scopes: Map<string, VariableSlot>[]
  loops: LoopContext[]
  returnType: LlvmType | undefined
}

const trueConstant: LlvmConstant = { kind: 'constant', type: 'i1', text: '1' }
const oneConstant: LlvmConstant = { kind: 'constant', type: 'double', text: '1.0' }
const voidValue: LlvmConstant = { kind: 'constant', type: 'void', text: 'void' }

/**
 * Generates LLVM IR from a syntax tree.
 */
export class Generator {
  /**
   * Generates the LLVM IR of a syntax tree.
   *
   * @param sourceFile Syntax tree to generate.
   * @param options Generator options.
   * @returns LLVM IR text.
   * @throws When the tree uses syntax that has no representation in the generated code yet.
   */
  public generate(sourceFile: ts.SourceFile, options: GeneratorOptions = {}): string {
    const context: GenerationContext = {
      builtins: new Map<string, Builtin>(
        (options.builtins ?? defaultBuiltins).map((builtin) => [builtin.name, builtin]),
      ),
      entryName: options.entryName ?? 'main',
      functions: new Map<string, FunctionSignature>(),
      loops: [],
      module: new LlvmModule(),
      returnType: undefined,
      scopes: [],
    }

    this.collectFunctions(sourceFile, context)

    for (const statement of sourceFile.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.body !== undefined) {
        this.generateFunction(statement, context)
      }
    }

    this.generateEntry(sourceFile, context)

    return context.module.emit()
  }

  /**
   * Collects the signatures of the functions declared by the tree.
   */
  private collectFunctions(sourceFile: ts.SourceFile, context: GenerationContext): void {
    for (const statement of sourceFile.statements) {
      if (!ts.isFunctionDeclaration(statement) || statement.body === undefined) {
        continue
      }

      const name = functionNameOf(statement, context.entryName)

      context.functions.set(name, this.signatureOf(statement, name))
    }
  }

  /**
   * Builds the signature of a function declaration.
   */
  private signatureOf(declaration: ts.FunctionDeclaration, name: string): FunctionSignature {
    if (declaration.type === undefined) {
      throw new Error(`Function '${name}' requires a return type annotation.`)
    }

    return {
      name,
      parameterTypes: declaration.parameters.map((parameter) => {
        if (parameter.dotDotDotToken !== undefined) {
          throw new Error(`Rest parameters are not supported yet in function '${name}'.`)
        }

        if (parameter.questionToken !== undefined) {
          throw new Error(`Optional parameters are not supported yet in function '${name}'.`)
        }

        if (parameter.type === undefined) {
          throw new Error(
            `Parameter '${parameterNameOf(parameter)}' of function '${name}' requires a type annotation.`,
          )
        }

        return irTypeFromNode(parameter.type)
      }),
      returnType: irTypeFromNode(declaration.type),
    }
  }

  /**
   * Generates the entry function that runs the top-level statements.
   */
  private generateEntry(sourceFile: ts.SourceFile, context: GenerationContext): void {
    const builder = context.module.addFunction(
      { name: context.entryName, parameterTypes: [], returnType: 'i32' },
      [],
    )
    context.scopes.push(new Map<string, VariableSlot>())

    for (const statement of sourceFile.statements) {
      if (ts.isFunctionDeclaration(statement)) {
        continue
      }

      this.generateStatement(statement, builder, context)
    }

    if (!builder.terminated) {
      builder.returnValue('i32', { kind: 'constant', type: 'i32', text: '0' })
    }

    context.scopes.pop()
  }

  /**
   * Generates a function declaration.
   */
  private generateFunction(declaration: ts.FunctionDeclaration, context: GenerationContext): void {
    const name = functionNameOf(declaration, context.entryName)
    const signature = context.functions.get(name)

    if (signature === undefined) {
      throw new Error(`Unknown function '${name}'.`)
    }

    if (declaration.body === undefined) {
      throw new Error(`Function '${name}' requires a body.`)
    }

    const builder = context.module.addFunction(
      signature,
      declaration.parameters.map((parameter) => parameterNameOf(parameter)),
    )
    context.returnType = signature.returnType
    context.scopes.push(new Map<string, VariableSlot>())

    declaration.parameters.forEach((parameter, index) => {
      const parameterType = signature.parameterTypes[index]

      if (parameterType === undefined) {
        throw new Error(`Parameter '${parameterNameOf(parameter)}' has no type.`)
      }

      const parameterName = parameterNameOf(parameter)
      const pointer = builder.alloca(parameterType, parameterName)

      builder.store(parameterType, { kind: 'local', name: parameterName }, pointer)
      this.declareVariable(
        parameterName,
        pointer,
        parameterType,
        irKindFromType(parameterType),
        context,
      )
    })

    this.generateStatement(declaration.body, builder, context)

    if (!builder.terminated) {
      if (signature.returnType === 'void') {
        builder.returnVoid()
      } else {
        builder.unreachable()
      }
    }

    context.scopes.pop()
    context.returnType = undefined
  }

  /**
   * Generates a statement.
   */
  private generateStatement(
    node: ts.Statement,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    if (builder.terminated) {
      builder.startBlock(builder.reserveLabel('dead'))
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        this.generateVariableDeclaration(declaration, builder, context)
      }

      return
    }

    if (ts.isExpressionStatement(node)) {
      this.generateExpression(node.expression, builder, context)

      return
    }

    if (ts.isIfStatement(node)) {
      this.generateIf(node, builder, context)

      return
    }

    if (ts.isWhileStatement(node)) {
      this.generateWhile(node, builder, context)

      return
    }

    if (ts.isForStatement(node)) {
      this.generateFor(node, builder, context)

      return
    }

    if (ts.isReturnStatement(node)) {
      this.generateReturn(node, builder, context)

      return
    }

    if (ts.isBreakStatement(node)) {
      const loop = context.loops[context.loops.length - 1]

      if (loop === undefined) {
        throw new Error('Break outside of a loop.')
      }

      builder.jump(loop.breakLabel)

      return
    }

    if (ts.isContinueStatement(node)) {
      const loop = context.loops[context.loops.length - 1]

      if (loop === undefined) {
        throw new Error('Continue outside of a loop.')
      }

      builder.jump(loop.continueLabel)

      return
    }

    if (ts.isBlock(node)) {
      context.scopes.push(new Map<string, VariableSlot>())

      for (const statement of node.statements) {
        this.generateStatement(statement, builder, context)
      }

      context.scopes.pop()

      return
    }

    if (ts.isFunctionDeclaration(node)) {
      throw new Error('Nested functions are not supported yet.')
    }

    throw new Error(`Unsupported statement: ${ts.SyntaxKind[node.kind]}.`)
  }

  /**
   * Generates a variable declaration.
   */
  private generateVariableDeclaration(
    declaration: ts.VariableDeclaration,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    if (!ts.isIdentifier(declaration.name)) {
      throw new Error('Variable declarations require a simple name.')
    }

    const name = declaration.name.text
    let type = declaration.type === undefined ? undefined : irTypeFromNode(declaration.type)
    const result =
      declaration.initializer === undefined
        ? undefined
        : this.generateExpression(declaration.initializer, builder, context)

    if (type === undefined) {
      if (result === undefined) {
        throw new Error(`Variable '${name}' requires a type annotation or an initializer.`)
      }

      type = irTypeFromKind(result.kind)
    }

    const kind = irKindFromType(type)

    if (kind === 'void') {
      throw new Error(`Variable '${name}' cannot be void.`)
    }

    if (result !== undefined && result.kind !== kind) {
      throw new Error(`Variable '${name}' is declared with a conflicting type.`)
    }

    const pointer = builder.alloca(type, name)
    const value =
      result === undefined ? this.defaultValueOf(kind, builder, context) : result.operand

    builder.store(type, value, pointer)
    this.declareVariable(name, pointer, type, kind, context)
  }

  /**
   * Generates an if statement.
   */
  private generateIf(
    node: ts.IfStatement,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    const condition = this.generateExpression(node.expression, builder, context)

    if (condition.kind !== 'boolean') {
      throw new Error('If conditions must be boolean.')
    }

    const thenLabel = builder.reserveLabel('if.then')
    const elseLabel = node.elseStatement === undefined ? undefined : builder.reserveLabel('if.else')
    const endLabel = builder.reserveLabel('if.end')

    builder.branch(condition.operand, thenLabel, elseLabel ?? endLabel)

    builder.startBlock(thenLabel)
    this.generateStatement(node.thenStatement, builder, context)

    if (!builder.terminated) {
      builder.jump(endLabel)
    }

    if (elseLabel !== undefined && node.elseStatement !== undefined) {
      builder.startBlock(elseLabel)
      this.generateStatement(node.elseStatement, builder, context)

      if (!builder.terminated) {
        builder.jump(endLabel)
      }
    }

    builder.startBlock(endLabel)
  }

  /**
   * Generates a while statement.
   */
  private generateWhile(
    node: ts.WhileStatement,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    const conditionLabel = builder.reserveLabel('while.cond')
    const bodyLabel = builder.reserveLabel('while.body')
    const endLabel = builder.reserveLabel('while.end')

    builder.jump(conditionLabel)

    builder.startBlock(conditionLabel)
    const condition = this.generateExpression(node.expression, builder, context)

    if (condition.kind !== 'boolean') {
      throw new Error('While conditions must be boolean.')
    }

    builder.branch(condition.operand, bodyLabel, endLabel)

    builder.startBlock(bodyLabel)
    context.loops.push({ breakLabel: endLabel, continueLabel: conditionLabel })
    this.generateStatement(node.statement, builder, context)
    context.loops.pop()

    if (!builder.terminated) {
      builder.jump(conditionLabel)
    }

    builder.startBlock(endLabel)
  }

  /**
   * Generates a for statement.
   */
  private generateFor(
    node: ts.ForStatement,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    context.scopes.push(new Map<string, VariableSlot>())

    if (node.initializer !== undefined) {
      if (ts.isVariableDeclarationList(node.initializer)) {
        for (const declaration of node.initializer.declarations) {
          this.generateVariableDeclaration(declaration, builder, context)
        }
      } else {
        this.generateExpression(node.initializer, builder, context)
      }
    }

    const conditionLabel = builder.reserveLabel('for.cond')
    const bodyLabel = builder.reserveLabel('for.body')
    const incrementLabel = builder.reserveLabel('for.inc')
    const endLabel = builder.reserveLabel('for.end')

    builder.jump(conditionLabel)

    builder.startBlock(conditionLabel)

    if (node.condition !== undefined) {
      const condition = this.generateExpression(node.condition, builder, context)

      if (condition.kind !== 'boolean') {
        throw new Error('For conditions must be boolean.')
      }

      builder.branch(condition.operand, bodyLabel, endLabel)
    } else {
      builder.jump(bodyLabel)
    }

    builder.startBlock(bodyLabel)
    context.loops.push({ breakLabel: endLabel, continueLabel: incrementLabel })

    this.generateStatement(node.statement, builder, context)

    context.loops.pop()

    if (!builder.terminated) {
      builder.jump(incrementLabel)
    }

    builder.startBlock(incrementLabel)

    if (node.incrementor !== undefined) {
      this.generateExpression(node.incrementor, builder, context)
    }

    builder.jump(conditionLabel)
    builder.startBlock(endLabel)
    context.scopes.pop()
  }

  /**
   * Generates a return statement.
   */
  private generateReturn(
    node: ts.ReturnStatement,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    if (context.returnType === undefined) {
      throw new Error('Return outside of a function is not supported.')
    }

    if (node.expression === undefined) {
      if (context.returnType !== 'void') {
        throw new Error('The function must return a value.')
      }

      builder.returnVoid()

      return
    }

    const value = this.generateExpression(node.expression, builder, context)

    if (value.kind !== irKindFromType(context.returnType)) {
      throw new Error('The returned value does not match the function return type.')
    }

    builder.returnValue(context.returnType, value.operand)
  }

  /**
   * Generates an expression.
   */
  private generateExpression(
    node: ts.Expression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    if (ts.isNumericLiteral(node)) {
      return {
        kind: 'number',
        operand: { kind: 'constant', type: 'double', text: formatDouble(Number(node.text)) },
      }
    }

    if (ts.isStringLiteral(node)) {
      return { kind: 'string', operand: this.stringPointer(node.text, builder, context) }
    }

    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
      return {
        kind: 'boolean',
        operand: {
          kind: 'constant',
          type: 'i1',
          text: formatBoolean(node.kind === ts.SyntaxKind.TrueKeyword),
        },
      }
    }

    if (ts.isIdentifier(node)) {
      const slot = this.lookupVariable(node.text, context)

      return { kind: slot.kind, operand: builder.load(slot.type, slot.pointer) }
    }

    if (ts.isBinaryExpression(node)) {
      return this.generateBinaryExpression(node, builder, context)
    }

    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      return this.generateUnaryExpression(node, builder, context)
    }

    if (ts.isCallExpression(node)) {
      return this.generateCallExpression(node, builder, context)
    }

    if (ts.isConditionalExpression(node)) {
      return this.generateConditionalExpression(node, builder, context)
    }

    if (ts.isParenthesizedExpression(node)) {
      return this.generateExpression(node.expression, builder, context)
    }

    throw new Error(`Unsupported expression: ${ts.SyntaxKind[node.kind]}.`)
  }

  /**
   * Generates a binary expression.
   */
  private generateBinaryExpression(
    node: ts.BinaryExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    const operator = node.operatorToken.kind

    if (
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken
    ) {
      return this.generateLogicalExpression(node, operator, builder, context)
    }

    if (operator === ts.SyntaxKind.EqualsToken) {
      return this.generateAssignment(node, builder, context)
    }

    const left = this.generateExpression(node.left, builder, context)
    const right = this.generateExpression(node.right, builder, context)

    if (isComparisonOperator(operator)) {
      return this.generateComparison(left, right, operator, builder)
    }

    if (
      operator === ts.SyntaxKind.PlusToken &&
      (left.kind === 'string' || right.kind === 'string')
    ) {
      throw new Error('String concatenation is not supported yet.')
    }

    if (left.kind === 'number' && right.kind === 'number') {
      const opcode = arithmeticOpcodeOf(operator)

      if (opcode === undefined) {
        throw new Error(`Unsupported operator: ${ts.SyntaxKind[operator]}.`)
      }

      return {
        kind: 'number',
        operand: builder.binary('double', opcode, left.operand, right.operand),
      }
    }

    throw new Error(`Unsupported operands for '${ts.SyntaxKind[operator]}'.`)
  }

  /**
   * Generates a comparison.
   */
  private generateComparison(
    left: ExpressionResult,
    right: ExpressionResult,
    operator: ts.SyntaxKind,
    builder: LlvmFunction,
  ): ExpressionResult {
    const negated =
      operator === ts.SyntaxKind.ExclamationEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsEqualsToken

    if (left.kind !== right.kind) {
      throw new Error('Comparison operands must have the same type.')
    }

    if (left.kind === 'number') {
      const opcode = comparisonOpcodeOf(operator)

      if (opcode === undefined) {
        throw new Error(`Unsupported comparison: ${ts.SyntaxKind[operator]}.`)
      }

      return {
        kind: 'boolean',
        operand: builder.binary('double', opcode, left.operand, right.operand),
      }
    }

    if (left.kind === 'string' || left.kind === 'boolean') {
      if (!isEqualityOperator(operator)) {
        throw new Error('Strings and booleans only support equality comparisons.')
      }

      const compared = builder.binary(
        irTypeFromKind(left.kind),
        'icmp eq',
        left.operand,
        right.operand,
      )

      return {
        kind: 'boolean',
        operand: negated ? builder.binary('i1', 'xor', compared, trueConstant) : compared,
      }
    }

    throw new Error(`Unsupported comparison operands: ${left.kind}.`)
  }

  /**
   * Generates a short-circuit logical expression.
   */
  private generateLogicalExpression(
    node: ts.BinaryExpression,
    operator: ts.SyntaxKind,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    const conjunction = operator === ts.SyntaxKind.AmpersandAmpersandToken
    const temp = builder.alloca('i1', conjunction ? 'and' : 'or')
    const rightLabel = builder.reserveLabel(conjunction ? 'and.right' : 'or.right')
    const endLabel = builder.reserveLabel(conjunction ? 'and.end' : 'or.end')
    const left = this.generateExpression(node.left, builder, context)

    if (left.kind !== 'boolean') {
      throw new Error('Logical operators require boolean operands.')
    }

    builder.store('i1', left.operand, temp)

    if (conjunction) {
      builder.branch(left.operand, rightLabel, endLabel)
    } else {
      builder.branch(left.operand, endLabel, rightLabel)
    }

    builder.startBlock(rightLabel)
    const right = this.generateExpression(node.right, builder, context)

    if (right.kind !== 'boolean') {
      throw new Error('Logical operators require boolean operands.')
    }

    builder.store('i1', right.operand, temp)
    builder.jump(endLabel)
    builder.startBlock(endLabel)

    return { kind: 'boolean', operand: builder.load('i1', temp) }
  }

  /**
   * Generates an assignment.
   */
  private generateAssignment(
    node: ts.BinaryExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    if (!ts.isIdentifier(node.left)) {
      throw new Error('Assignment targets must be variables.')
    }

    const slot = this.lookupVariable(node.left.text, context)
    const value = this.generateExpression(node.right, builder, context)

    if (value.kind !== slot.kind) {
      throw new Error(`Variable '${node.left.text}' cannot be assigned ${value.kind}.`)
    }

    builder.store(slot.type, value.operand, slot.pointer)

    return value
  }

  /**
   * Generates a unary expression.
   */
  private generateUnaryExpression(
    node: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    const operator = node.operator

    if (operator === ts.SyntaxKind.ExclamationToken) {
      const operand = this.generateExpression(node.operand, builder, context)

      if (operand.kind !== 'boolean') {
        throw new Error('Logical not requires a boolean.')
      }

      return {
        kind: 'boolean',
        operand: builder.binary('i1', 'xor', operand.operand, trueConstant),
      }
    }

    if (operator === ts.SyntaxKind.MinusToken) {
      const operand = this.generateExpression(node.operand, builder, context)

      if (operand.kind !== 'number') {
        throw new Error('Unary minus requires a number.')
      }

      return { kind: 'number', operand: builder.unary('double', 'fneg', operand.operand) }
    }

    if (operator === ts.SyntaxKind.PlusToken) {
      const operand = this.generateExpression(node.operand, builder, context)

      if (operand.kind !== 'number') {
        throw new Error('Unary plus requires a number.')
      }

      return operand
    }

    if (operator === ts.SyntaxKind.PlusPlusToken || operator === ts.SyntaxKind.MinusMinusToken) {
      return this.generateUpdateExpression(node, operator, builder, context)
    }

    throw new Error(`Unsupported unary operator: ${ts.SyntaxKind[operator]}.`)
  }

  /**
   * Generates an increment or decrement.
   */
  private generateUpdateExpression(
    node: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
    operator: ts.SyntaxKind,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    if (!ts.isIdentifier(node.operand)) {
      throw new Error('Increment and decrement targets must be variables.')
    }

    const slot = this.lookupVariable(node.operand.text, context)

    if (slot.kind !== 'number') {
      throw new Error('Increment and decrement require numbers.')
    }

    const current = builder.load(slot.type, slot.pointer)
    const updated = builder.binary(
      'double',
      operator === ts.SyntaxKind.PlusPlusToken ? 'fadd' : 'fsub',
      current,
      oneConstant,
    )

    builder.store(slot.type, updated, slot.pointer)

    return {
      kind: 'number',
      operand: ts.isPrefixUnaryExpression(node) ? updated : current,
    }
  }

  /**
   * Generates a function call.
   */
  private generateCallExpression(
    node: ts.CallExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    if (!ts.isIdentifier(node.expression)) {
      throw new Error('Only direct function calls are supported yet.')
    }

    const name = node.expression.text
    const signature = context.functions.get(name)
    const builtin = context.builtins.get(name)

    if (signature === undefined && builtin === undefined) {
      throw new Error(`Unknown function '${name}'.`)
    }

    if (builtin !== undefined) {
      return this.generateBuiltinCall(builtin, node, builder, context)
    }

    if (signature === undefined) {
      throw new Error(`Unknown function '${name}'.`)
    }

    if (node.arguments.length !== signature.parameterTypes.length) {
      throw new Error(
        `Function '${name}' expects ${String(signature.parameterTypes.length)} arguments.`,
      )
    }

    const args = node.arguments.map((argument, index) => {
      const parameterType = signature.parameterTypes[index]

      if (parameterType === undefined) {
        throw new Error(`Argument ${String(index)} of '${name}' has no type.`)
      }

      const result = this.generateExpression(argument, builder, context)

      if (result.kind !== irKindFromType(parameterType)) {
        throw new Error(
          `Argument ${String(index)} of '${name}' must be ${irKindFromType(parameterType)}.`,
        )
      }

      return { type: parameterType, value: result.operand }
    })
    const returned = builder.call(signature.returnType, name, args)

    return {
      kind: irKindFromType(signature.returnType),
      operand: returned ?? voidValue,
    }
  }

  /**
   * Generates a call to a builtin function.
   */
  private generateBuiltinCall(
    builtin: Builtin,
    node: ts.CallExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    if (node.arguments.length !== builtin.parameters.length) {
      throw new Error(
        `Builtin '${builtin.name}' expects ${String(builtin.parameters.length)} arguments.`,
      )
    }

    const argumentNode = node.arguments[0]

    if (argumentNode === undefined) {
      throw new Error(`Builtin '${builtin.name}' requires an argument.`)
    }

    const parameter = builtin.parameters[0]
    const argument = this.generateExpression(argumentNode, builder, context)

    if (parameter === undefined || !builtinAccepts(parameter, argument.kind)) {
      throw new Error(`Builtin '${builtin.name}' does not accept ${argument.kind} values.`)
    }

    context.module.addDeclaration('declare i32 @printf(ptr, ...)')
    const format = argument.kind === 'number' ? '%f\n' : '%s\n'
    const formatPointer = this.stringPointer(format, builder, context)
    let value = argument.operand
    let valueType = irTypeFromKind(argument.kind)

    if (argument.kind === 'boolean') {
      const truePointer = this.stringPointer('true', builder, context)
      const falsePointer = this.stringPointer('false', builder, context)

      value = builder.select('ptr', argument.operand, truePointer, falsePointer)
      valueType = 'ptr'
    }

    builder.call(
      'i32',
      'printf',
      [
        { type: 'ptr', value: formatPointer },
        { type: valueType, value },
      ],
      'ptr, ...',
    )

    return { kind: 'void', operand: voidValue }
  }

  /**
   * Generates a conditional expression.
   */
  private generateConditionalExpression(
    node: ts.ConditionalExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    const condition = this.generateExpression(node.condition, builder, context)

    if (condition.kind !== 'boolean') {
      throw new Error('Conditional expressions require a boolean condition.')
    }

    const trueLabel = builder.reserveLabel('cond.true')
    const falseLabel = builder.reserveLabel('cond.false')
    const endLabel = builder.reserveLabel('cond.end')

    builder.branch(condition.operand, trueLabel, falseLabel)

    builder.startBlock(trueLabel)
    const trueResult = this.generateExpression(node.whenTrue, builder, context)

    if (trueResult.kind === 'void') {
      throw new Error('Conditional expressions cannot produce void.')
    }

    const trueType = irTypeFromKind(trueResult.kind)
    const temp = builder.alloca(trueType, 'cond')

    builder.store(trueType, trueResult.operand, temp)
    builder.jump(endLabel)

    builder.startBlock(falseLabel)
    const falseResult = this.generateExpression(node.whenFalse, builder, context)

    if (falseResult.kind !== trueResult.kind) {
      throw new Error('Conditional expression branches must have the same type.')
    }

    builder.store(trueType, falseResult.operand, temp)
    builder.jump(endLabel)
    builder.startBlock(endLabel)

    return { kind: trueResult.kind, operand: builder.load(trueType, temp) }
  }

  /**
   * Returns a pointer to the global constant of a string.
   */
  private stringPointer(
    value: string,
    builder: LlvmFunction,
    context: GenerationContext,
  ): LlvmLocal {
    const global = context.module.addStringLiteral(value)

    return builder.stringPointer(global, context.module.stringLength(global))
  }

  /**
   * Returns the default value of a kind for uninitialized variables.
   */
  private defaultValueOf(
    kind: ValueKind,
    builder: LlvmFunction,
    context: GenerationContext,
  ): LlvmOperand {
    if (kind === 'boolean') {
      return { kind: 'constant', type: 'i1', text: '0' }
    }

    if (kind === 'number') {
      return { kind: 'constant', type: 'double', text: '0.0' }
    }

    if (kind === 'string') {
      return this.stringPointer('', builder, context)
    }

    throw new Error(`Variables of kind '${kind}' require an initializer.`)
  }

  /**
   * Declares a variable in the current scope.
   */
  private declareVariable(
    name: string,
    pointer: LlvmLocal,
    type: LlvmType,
    kind: ValueKind,
    context: GenerationContext,
  ): void {
    const scope = context.scopes[context.scopes.length - 1]

    if (scope === undefined) {
      throw new Error('No scope is being generated.')
    }

    scope.set(name, { kind, pointer, type })
  }

  /**
   * Looks up a variable in the scope chain.
   */
  private lookupVariable(name: string, context: GenerationContext): VariableSlot {
    for (let index = context.scopes.length - 1; index >= 0; index--) {
      const slot = context.scopes[index]?.get(name)

      if (slot !== undefined) {
        return slot
      }
    }

    throw new Error(`Unknown variable '${name}'.`)
  }
}

/**
 * Determines whether a builtin parameter accepts values of the given kind.
 */
function builtinAccepts(parameter: Type, kind: ValueKind): boolean {
  if (kind === 'void') {
    return false
  }

  const members = parameter.kind === 'union' ? parameter.types : [parameter]

  return members.some((member) => member.kind === 'primitive' && member.name === kind)
}

/**
 * Reads the name of a function declaration, rejecting reserved names.
 */
function functionNameOf(declaration: ts.FunctionDeclaration, reserved: string): string {
  if (declaration.name === undefined || !ts.isIdentifier(declaration.name)) {
    throw new Error('Functions require a simple name.')
  }

  const name = declaration.name.text

  if (name === reserved || name.includes('.')) {
    throw new Error(`Function name '${name}' is reserved.`)
  }

  return name
}

/**
 * Reads the name of a parameter.
 */
function parameterNameOf(parameter: ts.ParameterDeclaration): string {
  if (!ts.isIdentifier(parameter.name)) {
    throw new Error('Parameters require a simple name.')
  }

  return parameter.name.text
}

/**
 * Determines whether the operator is a comparison.
 */
function isComparisonOperator(operator: ts.SyntaxKind): boolean {
  return (
    operator === ts.SyntaxKind.EqualsEqualsToken ||
    operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    operator === ts.SyntaxKind.LessThanToken ||
    operator === ts.SyntaxKind.LessThanEqualsToken ||
    operator === ts.SyntaxKind.GreaterThanToken ||
    operator === ts.SyntaxKind.GreaterThanEqualsToken
  )
}

/**
 * Determines whether the operator is an equality check.
 */
function isEqualityOperator(operator: ts.SyntaxKind): boolean {
  return (
    operator === ts.SyntaxKind.EqualsEqualsToken ||
    operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsEqualsToken
  )
}

/**
 * Returns the float opcode of an arithmetic operator.
 */
function arithmeticOpcodeOf(operator: ts.SyntaxKind): string | undefined {
  if (operator === ts.SyntaxKind.PlusToken) {
    return 'fadd'
  }

  if (operator === ts.SyntaxKind.MinusToken) {
    return 'fsub'
  }

  if (operator === ts.SyntaxKind.AsteriskToken) {
    return 'fmul'
  }

  if (operator === ts.SyntaxKind.SlashToken) {
    return 'fdiv'
  }

  if (operator === ts.SyntaxKind.PercentToken) {
    return 'frem'
  }

  return undefined
}

/**
 * Returns the float comparison opcode of a comparison operator.
 */
function comparisonOpcodeOf(operator: ts.SyntaxKind): string | undefined {
  if (
    operator === ts.SyntaxKind.EqualsEqualsToken ||
    operator === ts.SyntaxKind.EqualsEqualsEqualsToken
  ) {
    return 'fcmp oeq'
  }

  if (
    operator === ts.SyntaxKind.ExclamationEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsEqualsToken
  ) {
    return 'fcmp one'
  }

  if (operator === ts.SyntaxKind.LessThanToken) {
    return 'fcmp olt'
  }

  if (operator === ts.SyntaxKind.LessThanEqualsToken) {
    return 'fcmp ole'
  }

  if (operator === ts.SyntaxKind.GreaterThanToken) {
    return 'fcmp ogt'
  }

  if (operator === ts.SyntaxKind.GreaterThanEqualsToken) {
    return 'fcmp oge'
  }

  return undefined
}
