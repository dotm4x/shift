import * as ts from 'typescript'

import { typeFromNode } from '../analyzer/types/syntax.js'
import {
  booleanType,
  f64Type,
  i8Type,
  i16Type,
  i32Type,
  i64Type,
  stringType,
  type Type,
  u8Type,
  u16Type,
  u32Type,
  unknownType,
  usizeType,
  voidType,
} from '../analyzer/types/type.js'
import { type Builtin, defaultBuiltins } from '../shared/builtins.js'
import { CompilerError } from '../shared/compiler-error.js'

import { type CallArgument, type FunctionSignature, type LlvmFunction } from './function.js'
import { LlvmModule } from './module.js'
import {
  irTypeFromType,
  isArrayType,
  isBooleanType,
  isFloatType,
  isIntegerType,
  isNumericType,
  isReferenceType,
  isSignedInteger,
  isStringType,
  isUnsignedInteger,
  isVoidType,
  sizeOf,
} from './types.js'
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
  /** Names available in the global scope without being declared. Defaults to no globals. */
  readonly globals?: readonly string[] | undefined
}

/** Result of generating an expression. */
interface ExpressionResult {
  readonly literalValue: number | undefined
  readonly operand: LlvmOperand
  readonly type: Type
}

/** Stack slot of a generated variable. */
interface VariableSlot {
  readonly pointer: LlvmOperand
  readonly type: Type
}

/** Labels of the loop being generated. */
interface LoopContext {
  readonly breakLabel: string
  readonly continueLabel: string
  readonly handlerDepth: number
}

/** Routing information for the code that runs when a try region exits. */
interface FinallyContext {
  readonly breakLabel: string | undefined
  readonly continueLabel: string | undefined
  readonly finallyLabel: string
  readonly loopHandlerDepth: number | undefined
  readonly returnPointer: LlvmLocal | undefined
  readonly returnType: LlvmType
  readonly statePointer: LlvmLocal
}

/** Visibility of a class member. */
type MemberVisibility = 'private' | 'protected' | 'public'

/** A field of a generated class. */
interface FieldInfo {
  readonly index: number
  readonly name: string
  readonly owner: string
  readonly type: Type
  readonly visibility: MemberVisibility
}

/** A method of a generated class. */
interface MethodInfo {
  readonly signature: FunctionSignature
  readonly visibility: MemberVisibility
}

/** Layout, methods and vtable of a generated class. */
interface ClassInfo {
  readonly base: string | undefined
  readonly fields: readonly FieldInfo[]
  allFields: readonly FieldInfo[]
  readonly methods: Map<string, MethodInfo>
  readonly name: string
  vtable: readonly string[]
}

/** State shared while generating a single syntax tree. */
interface GenerationContext {
  readonly builtins: Map<string, Builtin>
  readonly classes: Map<string, ClassInfo>
  readonly entryName: string
  finallyContexts: FinallyContext[]
  readonly functions: Map<string, FunctionSignature>
  readonly globals: ReadonlySet<string>
  handlerDepth: number
  readonly labels: Map<string, LoopContext>
  readonly objectLiterals: Map<LlvmOperand, ts.ObjectLiteralExpression>
  readonly objectDeclarations: Map<string, ts.ObjectLiteralExpression>
  loops: LoopContext[]
  readonly module: LlvmModule
  panicEmitted: boolean
  pendingLabel: string | undefined
  returnType: Type | undefined
  readonly scopes: Map<string, VariableSlot>[]
  readonly sourceClasses: Map<string, ts.ClassDeclaration>
  thisPointer: LlvmOperand | undefined
  thisType: string | undefined
}

const trueConstant: LlvmConstant = { kind: 'constant', type: 'i1', text: '1' }

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
      classes: new Map<string, ClassInfo>(),
      entryName: options.entryName ?? 'main',
      finallyContexts: [],
      functions: new Map<string, FunctionSignature>(),
      globals: new Set<string>(options.globals ?? []),
      handlerDepth: 0,
      labels: new Map<string, LoopContext>(),
      objectLiterals: new Map<LlvmOperand, ts.ObjectLiteralExpression>(),
      objectDeclarations: new Map<string, ts.ObjectLiteralExpression>(),
      loops: [],
      module: new LlvmModule(),
      panicEmitted: false,
      pendingLabel: undefined,
      returnType: undefined,
      scopes: [],
      sourceClasses: new Map<string, ts.ClassDeclaration>(),
      thisPointer: undefined,
      thisType: undefined,
    }

    this.collectClasses(sourceFile, context)
    this.collectFunctions(sourceFile, context)
    this.generateClasses(context)

    for (const statement of sourceFile.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.body !== undefined) {
        this.generateFunction(statement, context)
      }
    }

    this.generateEntry(sourceFile, context)

    return context.module.emit()
  }

  /**
   * Collects the classes declared by the tree and resolves their layouts and vtables.
   */
  private collectClasses(sourceFile: ts.SourceFile, context: GenerationContext): void {
    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement) || statement.name === undefined) {
        continue
      }

      const name = statement.name.text
      const fields: FieldInfo[] = []
      const methods = new Map<string, MethodInfo>()

      for (const member of statement.members) {
        const visibility = visibilityOf(member)

        if (ts.isPropertyDeclaration(member)) {
          const memberName = memberNameOf(member.name)

          if (member.type === undefined) {
            throw new CompilerError(
              'missing-annotation',
              `Field '${memberName}' of class '${name}' requires a type annotation.`,
              member,
            )
          }

          fields.push({
            index: 0,
            name: memberName,
            owner: name,
            type: typeFromNode(member.type),
            visibility,
          })
        } else if (ts.isMethodDeclaration(member)) {
          const memberName = memberNameOf(member.name)

          methods.set(memberName, {
            signature: methodSignatureOf(member, name, memberName),
            visibility,
          })
        } else if (ts.isConstructorDeclaration(member)) {
          methods.set('constructor', {
            signature: constructorSignatureOf(member, name),
            visibility,
          })
        }
      }

      context.classes.set(name, {
        allFields: [],
        base: baseNameOf(statement),
        fields,
        methods,
        name,
        vtable: [],
      })
      context.sourceClasses.set(name, statement)
    }

    for (const info of context.classes.values()) {
      const chain: string[] = []
      let current: string | undefined = info.name

      while (current !== undefined) {
        const classInfo = context.classes.get(current)

        if (classInfo === undefined) {
          throw new CompilerError('unknown-name', `Unknown class '${current}'.`, undefined)
        }

        chain.unshift(current)
        current = classInfo.base
      }

      const allFields: FieldInfo[] = []
      let index = 1

      for (const className of chain) {
        const classInfo = context.classes.get(className)

        if (classInfo === undefined) {
          throw new CompilerError('unknown-name', `Unknown class '${className}'.`, undefined)
        }

        for (const field of classInfo.fields) {
          allFields.push({
            index,
            name: field.name,
            owner: field.owner,
            type: field.type,
            visibility: field.visibility,
          })
          index++
        }
      }

      const base = info.base
      const vtable: string[] =
        base === undefined ? [] : [...(context.classes.get(base)?.vtable ?? [])]

      for (const methodName of info.methods.keys()) {
        if (methodName === 'constructor') {
          continue
        }

        if (!vtable.includes(methodName)) {
          vtable.push(methodName)
        }
      }

      info.allFields = allFields
      info.vtable = vtable
      context.module.addTypeDefinition(`%${info.name}`, [
        'ptr',
        ...allFields.map((field) => irTypeFromType(field.type)),
      ])
      context.module.addGlobal(
        `${vtableText(info)} = private unnamed_addr constant [${String(vtable.length)} x ptr] [ ${vtable
          .map((methodName) => `ptr @${info.name}.${methodName}`)
          .join(', ')} ]`,
      )
    }
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
      throw new CompilerError(
        'missing-annotation',
        `Function '${name}' requires a return type annotation.`,
        declaration,
      )
    }

    return {
      name,
      parameterTypes: declaration.parameters.map((parameter) => {
        if (parameter.dotDotDotToken !== undefined) {
          throw new CompilerError(
            'unsupported',
            `Rest parameters are not supported yet in function '${name}'.`,
            parameter,
          )
        }

        if (parameter.questionToken !== undefined) {
          throw new CompilerError(
            'unsupported',
            `Optional parameters are not supported yet in function '${name}'.`,
            parameter,
          )
        }

        if (parameter.type === undefined) {
          throw new CompilerError(
            'missing-annotation',
            `Parameter '${parameterNameOf(parameter)}' of function '${name}' requires a type annotation.`,
            declaration,
          )
        }

        return typeFromNode(parameter.type)
      }),
      returnType: typeFromNode(declaration.type),
    }
  }

  /**
   * Generates every method and constructor of every class.
   */
  private generateClasses(context: GenerationContext): void {
    for (const [className, info] of context.classes) {
      for (const [methodName, method] of info.methods) {
        const declaration = findMethodDeclaration(context, className, methodName)

        if (declaration === undefined) {
          throw new Error(`Method '${methodName}' of class '${className}' is missing.`)
        }

        this.generateMethod(declaration, className, methodName, method.signature, context)
      }
    }
  }

  /**
   * Generates the entry function that runs the top-level statements.
   */
  private generateEntry(sourceFile: ts.SourceFile, context: GenerationContext): void {
    const builder = context.module.addFunction(
      { name: context.entryName, parameterTypes: [], returnType: i32Type },
      [],
    )
    context.scopes.push(new Map<string, VariableSlot>())

    for (const statement of sourceFile.statements) {
      if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
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
      throw new CompilerError('unknown-name', `Unknown function '${name}'.`, declaration)
    }

    if (declaration.body === undefined) {
      throw new CompilerError('unsupported', `Function '${name}' requires a body.`, declaration)
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
        throw new CompilerError(
          'missing-annotation',
          `Parameter '${parameterNameOf(parameter)}' has no type.`,
          declaration,
        )
      }

      const parameterName = parameterNameOf(parameter)
      const pointer = builder.alloca(irTypeFromType(parameterType), parameterName)

      builder.store(irTypeFromType(parameterType), { kind: 'local', name: parameterName }, pointer)
      this.declareVariable(parameterName, pointer, parameterType, context)
    })

    this.generateStatement(declaration.body, builder, context)

    if (!builder.terminated) {
      if (isVoidType(signature.returnType)) {
        builder.returnVoid()
      } else {
        builder.unreachable()
      }
    }

    context.scopes.pop()
    context.returnType = undefined
  }

  /**
   * Generates a method or constructor of a class.
   */
  private generateMethod(
    declaration: ts.MethodDeclaration | ts.ConstructorDeclaration,
    className: string,
    methodName: string,
    signature: FunctionSignature,
    context: GenerationContext,
  ): void {
    const body = declaration.body

    if (body === undefined) {
      throw new CompilerError(
        'unsupported',
        `Method '${methodName}' of class '${className}' requires a body.`,
        declaration,
      )
    }

    const builder = context.module.addFunction(signature, [
      'this',
      ...declaration.parameters.map((parameter) => parameterNameOf(parameter)),
    ])
    const previousThisPointer = context.thisPointer
    const previousThisType = context.thisType
    const previousReturnType = context.returnType

    context.thisPointer = { kind: 'local', name: 'this' }
    context.thisType = className
    context.returnType = signature.returnType
    context.scopes.push(new Map<string, VariableSlot>())

    declaration.parameters.forEach((parameter, index) => {
      const parameterType = signature.parameterTypes[index + 1]

      if (parameterType === undefined) {
        throw new CompilerError(
          'missing-annotation',
          `Parameter '${parameterNameOf(parameter)}' has no type.`,
          declaration,
        )
      }

      const parameterName = parameterNameOf(parameter)
      const pointer = builder.alloca(irTypeFromType(parameterType), parameterName)

      builder.store(irTypeFromType(parameterType), { kind: 'local', name: parameterName }, pointer)
      this.declareVariable(parameterName, pointer, parameterType, context)
    })

    this.generateStatement(body, builder, context)

    if (!builder.terminated) {
      if (isVoidType(signature.returnType)) {
        builder.returnVoid()
      } else {
        builder.unreachable()
      }
    }

    context.scopes.pop()
    context.thisPointer = previousThisPointer
    context.thisType = previousThisType
    context.returnType = previousReturnType
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

    if (ts.isDoStatement(node)) {
      this.generateDoWhile(node, builder, context)

      return
    }

    if (ts.isForStatement(node)) {
      this.generateFor(node, builder, context)

      return
    }

    if (ts.isForOfStatement(node)) {
      this.generateForOf(node, builder, context)

      return
    }

    if (ts.isSwitchStatement(node)) {
      this.generateSwitch(node, builder, context)

      return
    }

    if (ts.isReturnStatement(node)) {
      this.generateReturn(node, builder, context)

      return
    }

    if (ts.isBreakStatement(node)) {
      this.generateBreak(node, builder, context)

      return
    }

    if (ts.isContinueStatement(node)) {
      this.generateContinue(node, builder, context)
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

    if (ts.isLabeledStatement(node)) {
      this.generateLabeledStatement(node, builder, context)

      return
    }

    if (ts.isTryStatement(node)) {
      this.generateTry(node, builder, context)

      return
    }

    if (
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      return
    }

    if (ts.isFunctionDeclaration(node)) {
      throw new CompilerError('unsupported', 'Nested functions are not supported yet.', node)
    }

    if (ts.isClassDeclaration(node)) {
      throw new CompilerError('unsupported', 'Nested classes are not supported yet.', node)
    }

    throw new CompilerError(
      'unsupported',
      `Unsupported statement: ${ts.SyntaxKind[node.kind]}.`,
      node,
    )
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
      throw new CompilerError(
        'unsupported',
        'Variable declarations require a simple name.',
        declaration,
      )
    }

    const name = declaration.name.text
    let type = declaration.type === undefined ? undefined : typeFromNode(declaration.type)
    let result =
      declaration.initializer === undefined
        ? undefined
        : this.generateExpression(declaration.initializer, builder, context)

    if (type === undefined) {
      if (result === undefined) {
        throw new CompilerError(
          'missing-annotation',
          `Variable '${name}' requires a type annotation or an initializer.`,
          declaration,
        )
      }

      type = result.type
    }

    if (result !== undefined) {
      result = this.adaptTo(declaration, result, type, builder, context)
    }

    const pointer = builder.alloca(irTypeFromType(type), name)
    const value = result === undefined ? this.defaultValueOf(declaration, type) : result.operand

    builder.store(irTypeFromType(type), value, pointer)
    this.declareVariable(name, pointer, type, context)

    if (
      declaration.initializer !== undefined &&
      ts.isObjectLiteralExpression(declaration.initializer)
    ) {
      context.objectDeclarations.set(name, declaration.initializer)
    }
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

    if (!isBooleanType(condition.type)) {
      throw new CompilerError('type-mismatch', 'If conditions must be boolean.', node)
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

    if (!isBooleanType(condition.type)) {
      throw new CompilerError('type-mismatch', 'While conditions must be boolean.', node)
    }

    builder.branch(condition.operand, bodyLabel, endLabel)

    builder.startBlock(bodyLabel)
    this.enterLoop(
      { breakLabel: endLabel, continueLabel: conditionLabel, handlerDepth: context.handlerDepth },
      context,
    )
    this.generateStatement(node.statement, builder, context)
    this.exitLoop(context)

    if (!builder.terminated) {
      builder.jump(conditionLabel)
    }

    builder.startBlock(endLabel)
  }

  /**
   * Generates a do-while statement.
   */
  private generateDoWhile(
    node: ts.DoStatement,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    const bodyLabel = builder.reserveLabel('do.body')
    const conditionLabel = builder.reserveLabel('do.cond')
    const endLabel = builder.reserveLabel('do.end')

    builder.jump(bodyLabel)

    builder.startBlock(bodyLabel)
    this.enterLoop(
      { breakLabel: endLabel, continueLabel: conditionLabel, handlerDepth: context.handlerDepth },
      context,
    )
    this.generateStatement(node.statement, builder, context)
    this.exitLoop(context)

    if (!builder.terminated) {
      builder.jump(conditionLabel)
    }

    builder.startBlock(conditionLabel)
    const condition = this.generateExpression(node.expression, builder, context)

    if (!isBooleanType(condition.type)) {
      throw new CompilerError('type-mismatch', 'Do-while conditions must be boolean.', node)
    }

    builder.branch(condition.operand, bodyLabel, endLabel)
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

      if (!isBooleanType(condition.type)) {
        throw new CompilerError('type-mismatch', 'For conditions must be boolean.', node)
      }

      builder.branch(condition.operand, bodyLabel, endLabel)
    } else {
      builder.jump(bodyLabel)
    }

    builder.startBlock(bodyLabel)
    this.enterLoop(
      { breakLabel: endLabel, continueLabel: incrementLabel, handlerDepth: context.handlerDepth },
      context,
    )

    this.generateStatement(node.statement, builder, context)

    this.exitLoop(context)

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
   * Generates a for-of statement over an array.
   */
  private generateForOf(
    node: ts.ForOfStatement,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    if (
      !ts.isVariableDeclarationList(node.initializer) ||
      node.initializer.declarations.length !== 1
    ) {
      throw new CompilerError(
        'type-mismatch',
        'For-of loops require a single variable declaration.',
        node,
      )
    }

    const declaration = node.initializer.declarations[0]

    if (declaration === undefined || !ts.isIdentifier(declaration.name)) {
      throw new CompilerError('type-mismatch', 'For-of loops require a simple variable name.', node)
    }

    const array = this.generateExpression(node.expression, builder, context)
    const arrayType = array.type

    if (!isArrayType(arrayType)) {
      throw new CompilerError('type-mismatch', 'For-of loops require an array.', node)
    }

    context.scopes.push(new Map<string, VariableSlot>())

    const elementType = arrayType.elementType
    const elementPointer = builder.alloca(irTypeFromType(elementType), declaration.name.text)
    this.declareVariable(declaration.name.text, elementPointer, elementType, context)

    const arrayPointer = builder.alloca('ptr', 'array')
    builder.store('ptr', array.operand, arrayPointer)
    const indexPointer = builder.alloca('i64', 'index')
    builder.store('i64', { kind: 'constant', type: 'i64', text: '0' }, indexPointer)

    const conditionLabel = builder.reserveLabel('forof.cond')
    const bodyLabel = builder.reserveLabel('forof.body')
    const incrementLabel = builder.reserveLabel('forof.inc')
    const endLabel = builder.reserveLabel('forof.end')

    builder.jump(conditionLabel)

    builder.startBlock(conditionLabel)
    const arrayValue = builder.load('ptr', arrayPointer)
    const length = builder.load('i64', arrayValue)
    const index = builder.load('i64', indexPointer)
    const outOfBounds = builder.binary('i64', 'icmp uge', index, length)
    builder.branch(outOfBounds, endLabel, bodyLabel)

    builder.startBlock(bodyLabel)
    const element = this.loadArrayElement(arrayValue, index, elementType, builder)
    builder.store(irTypeFromType(elementType), element, elementPointer)
    this.enterLoop(
      { breakLabel: endLabel, continueLabel: incrementLabel, handlerDepth: context.handlerDepth },
      context,
    )
    this.generateStatement(node.statement, builder, context)
    this.exitLoop(context)

    if (!builder.terminated) {
      builder.jump(incrementLabel)
    }

    builder.startBlock(incrementLabel)
    const nextIndex = builder.binary('i64', 'add', index, {
      kind: 'constant',
      type: 'i64',
      text: '1',
    })
    builder.store('i64', nextIndex, indexPointer)
    builder.jump(conditionLabel)
    builder.startBlock(endLabel)
    context.scopes.pop()
  }

  /**
   * Generates a switch statement with C-style fallthrough.
   */
  private generateSwitch(
    node: ts.SwitchStatement,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    const discriminant = this.generateExpression(node.expression, builder, context)

    if (!isNumericType(discriminant.type) && !isBooleanType(discriminant.type)) {
      throw new CompilerError(
        'type-mismatch',
        'Switch expressions must be numbers or booleans.',
        node,
      )
    }

    const discriminantType = irTypeFromType(discriminant.type)
    const discriminantPointer = builder.alloca(discriminantType, 'switch')
    builder.store(discriminantType, discriminant.operand, discriminantPointer)

    const endLabel = builder.reserveLabel('switch.end')
    const bodies: { clause: ts.CaseOrDefaultClause; label: string }[] = []

    for (const clause of node.caseBlock.clauses) {
      bodies.push({ clause, label: builder.reserveLabel('switch.case') })
    }

    let checkLabel: string | undefined
    const defaultEntry = bodies.find((body) => ts.isDefaultClause(body.clause))

    for (const body of bodies) {
      if (ts.isDefaultClause(body.clause)) {
        continue
      }

      const clause = body.clause
      const caseValue = this.generateExpression(clause.expression, builder, context)
      const adapted = this.adaptTo(node, caseValue, discriminant.type, builder, context)

      if (!sameType(adapted.type, discriminant.type)) {
        throw new CompilerError(
          'type-mismatch',
          'Case values must match the switch expression type.',
          node,
        )
      }

      const matchLabel = builder.reserveLabel('switch.check')
      const nextLabel = builder.reserveLabel('switch.check')

      if (checkLabel === undefined) {
        builder.jump(matchLabel)
      } else {
        builder.startBlock(checkLabel)
        builder.jump(matchLabel)
      }

      builder.startBlock(matchLabel)
      const loaded = builder.load(discriminantType, discriminantPointer)
      const matches = builder.binary(
        discriminantType,
        discriminantType === 'float' || discriminantType === 'double' ? 'fcmp oeq' : 'icmp eq',
        loaded,
        adapted.operand,
      )
      builder.branch(matches, body.label, nextLabel)
      checkLabel = nextLabel
    }

    const fallthroughLabel = defaultEntry === undefined ? endLabel : defaultEntry.label

    if (checkLabel === undefined) {
      builder.jump(fallthroughLabel)
    } else {
      builder.startBlock(checkLabel)
      builder.jump(fallthroughLabel)
    }

    for (let index = 0; index < bodies.length; index++) {
      const body = bodies[index]

      if (body === undefined) {
        throw new CompilerError('invalid-operation', 'Switch body is missing.', node)
      }

      builder.startBlock(body.label)

      for (const statement of body.clause.statements) {
        this.generateStatement(statement, builder, context)
      }

      if (!builder.terminated) {
        const next = bodies[index + 1]

        if (next === undefined) {
          builder.jump(endLabel)
        } else {
          builder.jump(next.label)
        }
      }
    }

    builder.startBlock(endLabel)
  }

  /**
   * Generates a labeled statement. Only loops can be labeled.
   */
  private generateLabeledStatement(
    node: ts.LabeledStatement,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    if (
      !ts.isWhileStatement(node.statement) &&
      !ts.isDoStatement(node.statement) &&
      !ts.isForStatement(node.statement) &&
      !ts.isForOfStatement(node.statement)
    ) {
      throw new CompilerError('unsupported', 'Only loops can be labeled.', node)
    }

    context.pendingLabel = node.label.text
    this.generateStatement(node.statement, builder, context)
    context.labels.delete(node.label.text)
    context.pendingLabel = undefined
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
      throw new CompilerError('unsupported', 'Return outside of a function is not supported.', node)
    }

    let value: ExpressionResult | undefined

    if (node.expression !== undefined) {
      value = this.generateExpression(node.expression, builder, context)
      value = this.adaptTo(node, value, context.returnType, builder, context)
    }

    const finallyContext = context.finallyContexts[context.finallyContexts.length - 1]

    if (finallyContext === undefined) {
      this.exitHandlers(context, builder)

      if (node.expression === undefined) {
        if (!isVoidType(context.returnType)) {
          throw new CompilerError('invalid-operation', 'The function must return a value.', node)
        }

        builder.returnVoid()

        return
      }

      if (value === undefined) {
        throw new CompilerError('invalid-operation', 'The returned value is missing.', node)
      }

      builder.returnValue(irTypeFromType(context.returnType), value.operand)

      return
    }

    if (node.expression === undefined) {
      if (!isVoidType(context.returnType)) {
        throw new CompilerError('invalid-operation', 'The function must return a value.', node)
      }
    } else {
      if (value === undefined) {
        throw new CompilerError('invalid-operation', 'The returned value is missing.', node)
      }

      if (finallyContext.returnPointer === undefined) {
        throw new CompilerError('type-mismatch', 'The function must not return a value.', node)
      }

      builder.store(finallyContext.returnType, value.operand, finallyContext.returnPointer)
    }

    builder.store('i32', { kind: 'constant', type: 'i32', text: '1' }, finallyContext.statePointer)
    builder.jump(finallyContext.finallyLabel)
  }

  /**
   * Generates a break statement.
   */
  private generateBreak(
    node: ts.BreakStatement,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    const loop = this.loopOf(node, node.label?.text, context)

    if (loop === undefined) {
      throw new CompilerError('invalid-operation', 'Break outside of a loop.', node)
    }

    this.exitToLoop(loop, context, builder)

    const finallyContext = context.finallyContexts[context.finallyContexts.length - 1]

    if (finallyContext !== undefined) {
      builder.store(
        'i32',
        { kind: 'constant', type: 'i32', text: '2' },
        finallyContext.statePointer,
      )
      builder.jump(finallyContext.finallyLabel)

      return
    }

    builder.jump(loop.breakLabel)
  }

  /**
   * Generates a continue statement.
   */
  private generateContinue(
    node: ts.ContinueStatement,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    const loop = this.loopOf(node, node.label?.text, context)

    if (loop === undefined) {
      throw new CompilerError('invalid-operation', 'Continue outside of a loop.', node)
    }

    this.exitToLoop(loop, context, builder)

    const finallyContext = context.finallyContexts[context.finallyContexts.length - 1]

    if (finallyContext !== undefined) {
      builder.store(
        'i32',
        { kind: 'constant', type: 'i32', text: '3' },
        finallyContext.statePointer,
      )
      builder.jump(finallyContext.finallyLabel)

      return
    }

    builder.jump(loop.continueLabel)
  }

  /**
   * Generates a try statement with optional catch and finally.
   */
  private generateTry(
    node: ts.TryStatement,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    const catchClause = node.catchClause
    const finallyClause = node.finallyBlock

    context.module.addDeclaration('declare ptr @GC_malloc(i64)')
    context.module.addDeclaration('declare i32 @setjmp(ptr) #0')
    context.module.addDeclaration('declare void @longjmp(ptr, i32)')
    context.module.addDeclaration('@stderr = external global ptr')
    context.module.requireReturnsTwice()

    const buffer = builder.allocaBytes(256, 'jmpbuf')
    const baseCount = builder.alloca('i64', 'handlers')
    this.pushHandler(buffer, baseCount, builder, context)
    context.handlerDepth++

    const setjmpLabel = builder.reserveLabel('try.invoke')
    const bodyLabel = builder.reserveLabel('try.body')
    const catchLabel = builder.reserveLabel('catch')
    const endLabel = builder.reserveLabel('try.end')

    builder.jump(setjmpLabel)
    builder.startBlock(setjmpLabel)
    const returned = builder.call('i32', 'setjmp', [{ type: 'ptr', value: buffer }])

    if (returned === undefined) {
      throw new CompilerError('invalid-operation', 'The setjmp call failed.', node)
    }

    const caught = builder.binary('i32', 'icmp ne', returned, {
      kind: 'constant',
      type: 'i32',
      text: '0',
    })
    builder.branch(caught, catchLabel, bodyLabel)

    builder.startBlock(bodyLabel)
    context.scopes.push(new Map<string, VariableSlot>())
    this.generateStatement(node.tryBlock, builder, context)
    context.scopes.pop()
    context.handlerDepth--

    if (!builder.terminated) {
      this.popHandler(builder, context)

      if (finallyClause === undefined) {
        builder.jump(endLabel)
      }
    }

    builder.startBlock(catchLabel)
    this.restoreHandlers(baseCount, builder, context)

    if (catchClause !== undefined) {
      context.scopes.push(new Map<string, VariableSlot>())

      if (catchClause.variableDeclaration !== undefined) {
        const declaration = catchClause.variableDeclaration

        if (!ts.isIdentifier(declaration.name)) {
          throw new CompilerError('unsupported', 'Catch bindings require a simple name.', node)
        }

        if (declaration.type !== undefined && !isStringType(typeFromNode(declaration.type))) {
          throw new CompilerError('type-mismatch', 'Catch bindings must be strings.', node)
        }

        const pointer = builder.alloca('ptr', declaration.name.text)
        context.module.addGlobal('@livescript.thrown = global ptr zeroinitializer')
        const thrown = builder.load('ptr', { kind: 'global', name: 'livescript.thrown' })
        builder.store('ptr', thrown, pointer)
        this.declareVariable(declaration.name.text, pointer, stringType, context)
      }

      this.generateStatement(catchClause.block, builder, context)

      context.scopes.pop()
    }

    if (!builder.terminated && finallyClause === undefined) {
      builder.jump(endLabel)
    }

    if (finallyClause === undefined) {
      builder.startBlock(endLabel)

      return
    }

    const statePointer = builder.alloca('i32', 'finally.state')
    const returnPointer =
      context.returnType === undefined || isVoidType(context.returnType)
        ? undefined
        : builder.alloca(irTypeFromType(context.returnType), 'finally.value')
    const loop = context.loops[context.loops.length - 1]
    const finallyLabel = builder.reserveLabel('finally')
    const finallyContext: FinallyContext = {
      breakLabel: loop?.breakLabel,
      continueLabel: loop?.continueLabel,
      finallyLabel,
      loopHandlerDepth: loop?.handlerDepth,
      returnPointer,
      returnType: context.returnType === undefined ? 'void' : irTypeFromType(context.returnType),
      statePointer,
    }

    context.finallyContexts.push(finallyContext)
    builder.startBlock(finallyLabel)
    context.scopes.push(new Map<string, VariableSlot>())
    this.generateStatement(finallyClause, builder, context)
    context.scopes.pop()
    context.finallyContexts.pop()

    const state = builder.load('i32', statePointer)
    const routeLabel = builder.reserveLabel('finally.after')
    const returnLabel = builder.reserveLabel('finally.return')
    const breakLabel = builder.reserveLabel('finally.break')
    const continueLabel = builder.reserveLabel('finally.continue')

    builder.switchValue(state, routeLabel, [
      { label: returnLabel, value: 1 },
      { label: breakLabel, value: 2 },
      { label: continueLabel, value: 3 },
    ])

    builder.startBlock(returnLabel)
    this.exitHandlers(context, builder)

    if (returnPointer === undefined) {
      builder.returnVoid()
    } else {
      const returned = builder.load(finallyContext.returnType, returnPointer)
      builder.returnValue(finallyContext.returnType, returned)
    }

    builder.startBlock(breakLabel)

    if (finallyContext.breakLabel !== undefined) {
      builder.jump(finallyContext.breakLabel)
    } else {
      builder.unreachable()
    }

    builder.startBlock(continueLabel)

    if (finallyContext.continueLabel !== undefined) {
      builder.jump(finallyContext.continueLabel)
    } else {
      builder.unreachable()
    }

    builder.startBlock(routeLabel)
    builder.startBlock(endLabel)
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
      return numericLiteralResult(Number(node.text))
    }

    if (ts.isStringLiteral(node)) {
      return {
        literalValue: undefined,
        operand: this.stringPointer(node.text, builder, context),
        type: stringType,
      }
    }

    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
      return {
        literalValue: undefined,
        operand: {
          kind: 'constant',
          type: 'i1',
          text: formatBoolean(node.kind === ts.SyntaxKind.TrueKeyword),
        },
        type: booleanType,
      }
    }

    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      if (context.thisPointer === undefined || context.thisType === undefined) {
        throw new CompilerError('unsupported', 'This outside of a class is not supported.', node)
      }

      return {
        literalValue: undefined,
        operand: context.thisPointer,
        type: { kind: 'reference', name: context.thisType, typeArguments: [] },
      }
    }

    if (ts.isIdentifier(node)) {
      const slot = this.lookupVariable(node, node.text, context)

      return {
        literalValue: undefined,
        operand: builder.load(irTypeFromType(slot.type), slot.pointer),
        type: slot.type,
      }
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

    if (ts.isPropertyAccessExpression(node)) {
      return this.generateMemberAccess(node, builder, context)
    }

    if (ts.isElementAccessExpression(node)) {
      return this.generateElementAccess(node, builder, context)
    }

    if (ts.isArrayLiteralExpression(node)) {
      return this.generateArrayLiteral(node, builder, context)
    }

    if (ts.isObjectLiteralExpression(node)) {
      return this.generateObjectLiteral(node, builder, context)
    }

    if (ts.isNewExpression(node)) {
      return this.generateNew(node, builder, context)
    }

    if (ts.isConditionalExpression(node)) {
      return this.generateConditionalExpression(node, builder, context)
    }

    if (ts.isAsExpression(node)) {
      const expression = this.generateExpression(node.expression, builder, context)

      return this.castTo(node, expression, typeFromNode(node.type), builder)
    }

    if (ts.isParenthesizedExpression(node)) {
      return this.generateExpression(node.expression, builder, context)
    }

    throw new CompilerError(
      'unsupported',
      `Unsupported expression: ${ts.SyntaxKind[node.kind]}.`,
      node,
    )
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

    if (isAssignmentOperator(operator)) {
      return this.generateAssignment(node, operator, builder, context)
    }

    let left = this.generateExpression(node.left, builder, context)
    let right = this.generateExpression(node.right, builder, context)

    if (!sameType(left.type, right.type)) {
      if (left.literalValue !== undefined) {
        left = this.adaptTo(node, left, right.type, builder, context)
      } else if (right.literalValue !== undefined) {
        right = this.adaptTo(node, right, left.type, builder, context)
      }
    }

    if (isIntegerType(left.type) && isIntegerType(right.type) && !sameType(left.type, right.type)) {
      const common = commonIntegerTypeOf(left.type, right.type)

      if (common !== undefined) {
        left = this.castTo(node, left, common, builder)
        right = this.castTo(node, right, common, builder)
      }
    }

    if (isComparisonOperator(operator)) {
      return this.generateComparison(node, left, right, operator, builder, context)
    }

    if (isStringType(left.type) || isStringType(right.type)) {
      if (operator !== ts.SyntaxKind.PlusToken) {
        throw new CompilerError(
          'type-mismatch',
          `Strings do not support '${ts.SyntaxKind[operator]}'.`,
          node,
        )
      }

      if (!isStringType(left.type) || !isStringType(right.type)) {
        throw new CompilerError('type-mismatch', 'String concatenation requires two strings.', node)
      }

      return this.concatenateStrings(node, left, right, builder, context)
    }

    if (!sameType(left.type, right.type)) {
      throw new CompilerError(
        'type-mismatch',
        `Operands must have the same type: ${describeType(left.type)} and ${describeType(right.type)}.`,
        node,
      )
    }

    if (isNumericType(left.type)) {
      const opcode = arithmeticOpcodeOf(operator, left.type)

      if (opcode === undefined) {
        throw new CompilerError(
          'unsupported',
          `Unsupported operator: ${ts.SyntaxKind[operator]}.`,
          node,
        )
      }

      if (isDivisionOperator(operator)) {
        this.generateDivisionCheck(left, builder, context)
      }

      return {
        literalValue: undefined,
        operand: builder.binary(irTypeFromType(left.type), opcode, left.operand, right.operand),
        type: left.type,
      }
    }

    throw new CompilerError(
      'unsupported',
      `Unsupported operands for '${ts.SyntaxKind[operator]}'.`,
      node,
    )
  }

  /**
   * Generates a comparison.
   */
  private generateComparison(
    node: ts.BinaryExpression,
    left: ExpressionResult,
    right: ExpressionResult,
    operator: ts.SyntaxKind,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    let leftResult = left
    let rightResult = right

    if (!sameType(leftResult.type, rightResult.type)) {
      if (leftResult.literalValue !== undefined) {
        leftResult = this.adaptTo(node, leftResult, rightResult.type, builder, context)
      } else if (rightResult.literalValue !== undefined) {
        rightResult = this.adaptTo(node, rightResult, leftResult.type, builder, context)
      }
    }

    if (
      isIntegerType(leftResult.type) &&
      isIntegerType(rightResult.type) &&
      !sameType(leftResult.type, rightResult.type)
    ) {
      const common = commonIntegerTypeOf(leftResult.type, rightResult.type)

      if (common !== undefined) {
        leftResult = this.castTo(node, leftResult, common, builder)
        rightResult = this.castTo(node, rightResult, common, builder)
      }
    }

    if (!sameType(leftResult.type, rightResult.type)) {
      throw new CompilerError(
        'type-mismatch',
        `Comparison operands must have the same type: ${describeType(leftResult.type)} and ${describeType(rightResult.type)}.`,
        node,
      )
    }

    if (isStringType(leftResult.type)) {
      context.module.addDeclaration('declare i32 @strcmp(ptr, ptr)')
      const compared = builder.call('i32', 'strcmp', [
        { type: 'ptr', value: leftResult.operand },
        { type: 'ptr', value: rightResult.operand },
      ])
      const result = this.compareAgainstZero(node, compared, operator, builder)

      return { literalValue: undefined, operand: result, type: booleanType }
    }

    if (isNumericType(leftResult.type) || isBooleanType(leftResult.type)) {
      const opcode = comparisonOpcodeOf(operator, leftResult.type)

      if (opcode === undefined) {
        throw new CompilerError(
          'unsupported',
          `Unsupported comparison: ${ts.SyntaxKind[operator]}.`,
          node,
        )
      }

      return {
        literalValue: undefined,
        operand: builder.binary(
          irTypeFromType(leftResult.type),
          opcode,
          leftResult.operand,
          rightResult.operand,
        ),
        type: booleanType,
      }
    }

    throw new CompilerError(
      'unsupported',
      `Unsupported comparison operands: ${describeType(leftResult.type)}.`,
      node,
    )
  }

  /**
   * Compares an i32 against zero for string comparisons.
   */
  private compareAgainstZero(
    node: ts.Node,
    compared: LlvmLocal | undefined,
    operator: ts.SyntaxKind,
    builder: LlvmFunction,
  ): LlvmLocal {
    if (compared === undefined) {
      throw new CompilerError('invalid-operation', 'The string comparison failed.', node)
    }

    const opcode = signedComparisonOpcodeOf(operator)

    if (opcode === undefined) {
      throw new CompilerError(
        'type-mismatch',
        `Strings do not support '${ts.SyntaxKind[operator]}'.`,
        node,
      )
    }

    return builder.binary('i32', opcode, compared, {
      kind: 'constant',
      type: 'i32',
      text: '0',
    })
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

    if (!isBooleanType(left.type)) {
      throw new CompilerError('type-mismatch', 'Logical operators require boolean operands.', node)
    }

    builder.store('i1', left.operand, temp)

    if (conjunction) {
      builder.branch(left.operand, rightLabel, endLabel)
    } else {
      builder.branch(left.operand, endLabel, rightLabel)
    }

    builder.startBlock(rightLabel)
    const right = this.generateExpression(node.right, builder, context)

    if (!isBooleanType(right.type)) {
      throw new CompilerError('type-mismatch', 'Logical operators require boolean operands.', node)
    }

    builder.store('i1', right.operand, temp)
    builder.jump(endLabel)
    builder.startBlock(endLabel)

    return {
      literalValue: undefined,
      operand: builder.load('i1', temp),
      type: booleanType,
    }
  }

  /**
   * Generates an assignment, including compound assignments.
   */
  private generateAssignment(
    node: ts.BinaryExpression,
    operator: ts.SyntaxKind,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    const target = this.generateAssignmentTarget(node.left, builder, context)
    let value = this.generateExpression(node.right, builder, context)
    value = this.adaptTo(node, value, target.type, builder, context)

    if (operator !== ts.SyntaxKind.EqualsToken) {
      const arithmeticOperator = compoundOperatorOf(operator)

      if (arithmeticOperator === undefined) {
        throw new CompilerError(
          'unsupported',
          `Unsupported assignment operator: ${ts.SyntaxKind[operator]}.`,
          node,
        )
      }

      if (isStringType(target.type)) {
        throw new CompilerError(
          'type-mismatch',
          'Strings do not support compound assignment.',
          node,
        )
      }

      if (!isNumericType(target.type)) {
        throw new CompilerError('type-mismatch', 'Compound assignment requires numbers.', node)
      }

      const current = builder.load(irTypeFromType(target.type), target.pointer)
      const opcode = arithmeticOpcodeOf(arithmeticOperator, target.type)

      if (opcode === undefined) {
        throw new CompilerError(
          'unsupported',
          `Unsupported assignment operator: ${ts.SyntaxKind[operator]}.`,
          node,
        )
      }

      if (isDivisionOperator(arithmeticOperator)) {
        this.generateDivisionCheck(
          { literalValue: undefined, operand: current, type: target.type },
          builder,
          context,
        )
      }

      const updated = builder.binary(irTypeFromType(target.type), opcode, current, value.operand)
      value = { literalValue: undefined, operand: updated, type: target.type }
    }

    builder.store(irTypeFromType(target.type), value.operand, target.pointer)

    return value
  }

  /**
   * Resolves the storage of an assignment target.
   */
  private generateAssignmentTarget(
    node: ts.Expression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): { pointer: LlvmOperand; type: Type } {
    if (ts.isIdentifier(node)) {
      const slot = this.lookupVariable(node, node.text, context)

      return { pointer: slot.pointer, type: slot.type }
    }

    if (ts.isPropertyAccessExpression(node)) {
      const address = this.generateFieldAddress(node, builder, context)

      return { pointer: address.pointer, type: address.type }
    }

    if (ts.isElementAccessExpression(node)) {
      const address = this.generateElementAddress(node, builder, context)

      return { pointer: address.pointer, type: address.type }
    }

    throw new CompilerError(
      'type-mismatch',
      'Assignment targets must be variables, fields or array elements.',
      node,
    )
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

      if (!isBooleanType(operand.type)) {
        throw new CompilerError('type-mismatch', 'Logical not requires a boolean.', node)
      }

      return {
        literalValue: undefined,
        operand: builder.binary('i1', 'xor', operand.operand, trueConstant),
        type: booleanType,
      }
    }

    if (operator === ts.SyntaxKind.MinusToken) {
      const operand = this.generateExpression(node.operand, builder, context)

      if (operand.literalValue !== undefined) {
        return numericLiteralResult(-operand.literalValue)
      }

      if (isFloatType(operand.type)) {
        return {
          literalValue: undefined,
          operand: builder.unary(irTypeFromType(operand.type), 'fneg', operand.operand),
          type: operand.type,
        }
      }

      if (isSignedInteger(operand.type)) {
        const zero: LlvmConstant = {
          kind: 'constant',
          type: irTypeFromType(operand.type),
          text: '0',
        }

        return {
          literalValue: undefined,
          operand: builder.binary(irTypeFromType(operand.type), 'sub', zero, operand.operand),
          type: operand.type,
        }
      }

      throw new CompilerError('type-mismatch', 'Unary minus requires a signed number.', node)
    }

    if (operator === ts.SyntaxKind.PlusToken) {
      const operand = this.generateExpression(node.operand, builder, context)

      if (!isNumericType(operand.type)) {
        throw new CompilerError('type-mismatch', 'Unary plus requires a number.', node)
      }

      return operand
    }

    if (operator === ts.SyntaxKind.PlusPlusToken || operator === ts.SyntaxKind.MinusMinusToken) {
      return this.generateUpdateExpression(node, operator, builder, context)
    }

    throw new CompilerError(
      'unsupported',
      `Unsupported unary operator: ${ts.SyntaxKind[operator]}.`,
      node,
    )
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
    const target = this.generateAssignmentTarget(node.operand, builder, context)

    if (!isNumericType(target.type)) {
      throw new CompilerError('type-mismatch', 'Increment and decrement require numbers.', node)
    }

    const current = builder.load(irTypeFromType(target.type), target.pointer)
    const updated = builder.binary(
      irTypeFromType(target.type),
      operator === ts.SyntaxKind.PlusPlusToken ? 'add' : 'sub',
      current,
      { kind: 'constant', type: irTypeFromType(target.type), text: '1' },
    )

    builder.store(irTypeFromType(target.type), updated, target.pointer)

    return {
      literalValue: undefined,
      operand: ts.isPrefixUnaryExpression(node) ? updated : current,
      type: target.type,
    }
  }

  /**
   * Generates a function, builtin or method call.
   */
  private generateCallExpression(
    node: ts.CallExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    if (ts.isPropertyAccessExpression(node.expression)) {
      return this.generateMemberCall(node, builder, context)
    }

    if (node.expression.kind === ts.SyntaxKind.SuperKeyword) {
      return this.generateSuperConstructorCall(node, builder, context)
    }

    if (!ts.isIdentifier(node.expression)) {
      throw new CompilerError('unsupported', 'Only direct function calls are supported yet.', node)
    }

    const name = node.expression.text
    const signature = context.functions.get(name)
    const builtin = context.builtins.get(name)

    if (signature === undefined && builtin === undefined) {
      throw new CompilerError('unknown-name', `Unknown function '${name}'.`, node)
    }

    if (builtin !== undefined) {
      return this.generateBuiltinCall(builtin, node, builder, context)
    }

    if (signature === undefined) {
      throw new CompilerError('unknown-name', `Unknown function '${name}'.`, node)
    }

    if (node.arguments.length !== signature.parameterTypes.length) {
      throw new CompilerError(
        'type-mismatch',
        `Function '${name}' expects ${String(signature.parameterTypes.length)} arguments.`,
        node,
      )
    }

    const args = this.generateCallArguments(node, signature.parameterTypes, builder, context)
    const returned = builder.call(irTypeFromType(signature.returnType), name, args)

    return {
      literalValue: undefined,
      operand: returned ?? { kind: 'constant', type: 'void', text: 'void' },
      type: signature.returnType,
    }
  }

  /**
   * Generates the arguments of a call, adapting them to the parameter types.
   */
  private generateCallArguments(
    node: ts.CallExpression,
    parameterTypes: readonly Type[],
    builder: LlvmFunction,
    context: GenerationContext,
  ): CallArgument[] {
    if (node.arguments.length !== parameterTypes.length) {
      throw new CompilerError(
        'type-mismatch',
        `The call expects ${String(parameterTypes.length)} arguments.`,
        node,
      )
    }

    return node.arguments.map((argument, index) => {
      const parameterType = parameterTypes[index]

      if (parameterType === undefined) {
        throw new CompilerError(
          'missing-annotation',
          `Argument ${String(index)} has no type.`,
          node,
        )
      }

      const result = this.generateExpression(argument, builder, context)
      const adapted = this.adaptTo(node, result, parameterType, builder, context)

      return { type: irTypeFromType(parameterType), value: adapted.operand }
    })
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
      throw new CompilerError(
        'type-mismatch',
        `Builtin '${builtin.name}' expects ${String(builtin.parameters.length)} arguments.`,
        node,
      )
    }

    const argumentNode = node.arguments[0]

    if (argumentNode === undefined) {
      throw new CompilerError(
        'type-mismatch',
        `Builtin '${builtin.name}' requires an argument.`,
        node,
      )
    }

    const parameter = builtin.parameters[0]
    const argument = this.generateExpression(argumentNode, builder, context)

    if (parameter === undefined || !builtinAccepts(parameter, argument.type)) {
      throw new CompilerError(
        'type-mismatch',
        `Builtin '${builtin.name}' does not accept ${describeType(argument.type)} values.`,
        node,
      )
    }

    context.module.addDeclaration('declare i32 @printf(ptr, ...)')
    const format = printFormatOf(argument.type)
    const formatPointer = this.stringPointer(format.text, builder, context)
    let value = argument.operand
    let valueType = irTypeFromType(argument.type)

    if (isBooleanType(argument.type)) {
      const truePointer = this.stringPointer('true', builder, context)
      const falsePointer = this.stringPointer('false', builder, context)

      value = builder.select('ptr', argument.operand, truePointer, falsePointer)
      valueType = 'ptr'
    }

    if (isIntegerType(argument.type) && sizeOf(argument.type) < 4) {
      value = this.widenToI32(node, argument, builder).operand
      valueType = 'i32'
    }

    if (argument.type.kind === 'primitive' && argument.type.name === 'f32') {
      value = builder.cast('fpext', 'float', argument.operand, 'double')
      valueType = 'double'
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

    return {
      literalValue: undefined,
      operand: { kind: 'constant', type: 'void', text: 'void' },
      type: voidType,
    }
  }

  /**
   * Generates a member access, such as `car.year` or `array.length`.
   */
  private generateMemberAccess(
    node: ts.PropertyAccessExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    const address = this.generateFieldAddress(node, builder, context)

    return {
      literalValue: undefined,
      operand: builder.load(irTypeFromType(address.type), address.pointer),
      type: address.type,
    }
  }

  /**
   * Resolves the storage of a field access.
   */
  private generateFieldAddress(
    node: ts.PropertyAccessExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): { pointer: LlvmOperand; type: Type } {
    const memberName = memberNameOf(node.name)

    if (node.expression.kind === ts.SyntaxKind.SuperKeyword) {
      return this.generateSuperFieldAddress(node, memberName, builder, context)
    }

    const target = this.generateExpression(node.expression, builder, context)

    if (isArrayType(target.type)) {
      if (memberName !== 'length') {
        throw new CompilerError('invalid-operation', 'Arrays only support length.', node)
      }

      return { pointer: this.lengthAddress(target.operand, builder), type: usizeType }
    }

    if (target.type.kind === 'unknown') {
      const qualifiedName = ts.isIdentifier(node.expression)
        ? `${node.expression.text}.${memberName}`
        : memberName

      context.module.addDeclaration(`@${qualifiedName} = external global ptr`)

      return { pointer: { kind: 'global', name: qualifiedName }, type: unknownType }
    }

    if (isNumericType(target.type) || isBooleanType(target.type)) {
      const qualifiedName = ts.isIdentifier(node.expression)
        ? `${node.expression.text}.${memberName}`
        : memberName

      context.module.addDeclaration(`@${qualifiedName} = external global i32`)

      return { pointer: { kind: 'global', name: qualifiedName }, type: unknownType }
    }

    if (target.type.kind === 'object') {
      const properties = target.type.properties
      const index = properties.findIndex((property) => property.name === memberName)

      if (index === -1) {
        throw new CompilerError('unknown-name', `The object has no property '${memberName}'.`, node)
      }

      const property = properties[index]

      if (property === undefined) {
        throw new CompilerError('unknown-name', `The object has no property '${memberName}'.`, node)
      }

      const offset =
        8 +
        properties.slice(0, index).reduce((total, candidate) => total + sizeOf(candidate.type), 0)
      const pointer = builder.bytePointer(target.operand, {
        kind: 'constant',
        type: 'i64',
        text: String(offset),
      })

      return { pointer, type: property.type }
    }

    if (isReferenceType(target.type)) {
      const classInfo = this.classInfoOf(node, target.type.name, context)
      const field = classInfo.allFields.find((candidate) => candidate.name === memberName)

      if (field !== undefined) {
        this.checkVisibility(node, field.visibility, field.owner, memberName, context)
        const pointer = builder.fieldPointer(`%${classInfo.name}`, target.operand, field.index)

        return { pointer, type: field.type }
      }

      if (this.findMethod(context, classInfo, memberName) !== undefined) {
        throw new CompilerError(
          'unsupported',
          `Methods must be called: use '${memberName}(...)'.`,
          node,
        )
      }

      throw new CompilerError(
        'invalid-operation',
        `Class '${classInfo.name}' has no member '${memberName}'.`,
        node,
      )
    }

    throw new CompilerError(
      'invalid-operation',
      `Values of type '${describeType(target.type)}' have no members.`,
      node,
    )
  }

  /**
   * Resolves the storage of a field access through the base class.
   */
  private generateSuperFieldAddress(
    node: ts.Node,
    memberName: string,
    builder: LlvmFunction,
    context: GenerationContext,
  ): { pointer: LlvmLocal; type: Type } {
    if (context.thisPointer === undefined || context.thisType === undefined) {
      throw new CompilerError('unsupported', 'Super outside of a class is not supported.', node)
    }

    const classInfo = this.classInfoOf(node, context.thisType, context)

    if (classInfo.base === undefined) {
      throw new CompilerError(
        'invalid-operation',
        `Class '${classInfo.name}' has no base class.`,
        node,
      )
    }

    const baseInfo = this.classInfoOf(node, classInfo.base, context)
    const field = baseInfo.allFields.find((candidate) => candidate.name === memberName)

    if (field === undefined) {
      throw new CompilerError(
        'invalid-operation',
        `Class '${baseInfo.name}' has no field '${memberName}'.`,
        node,
      )
    }

    const pointer = builder.fieldPointer(`%${baseInfo.name}`, context.thisPointer, field.index)

    return { pointer, type: field.type }
  }

  /**
   * Generates a method call, such as `car.drive()`.
   */
  private generateMemberCall(
    node: ts.CallExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    const access = node.expression

    if (!ts.isPropertyAccessExpression(access)) {
      throw new CompilerError('type-mismatch', 'Method calls require a member access.', node)
    }

    if (access.expression.kind === ts.SyntaxKind.SuperKeyword) {
      return this.generateSuperCall(access, node, builder, context)
    }

    const target = this.generateExpression(access.expression, builder, context)
    const memberName = memberNameOf(access.name)

    if (isArrayType(target.type)) {
      throw new CompilerError('invalid-operation', 'Arrays have no methods yet.', node)
    }

    if (isStringType(target.type)) {
      throw new CompilerError('invalid-operation', 'Strings have no methods yet.', node)
    }

    if (target.type.kind === 'unknown') {
      return this.generateExternalCall(node, access, builder, context)
    }

    if (target.type.kind === 'object') {
      return this.generateObjectMethodCall(node, target, builder, context)
    }

    if (!isReferenceType(target.type)) {
      throw new CompilerError(
        'invalid-operation',
        `Values of type '${describeType(target.type)}' have no methods.`,
        node,
      )
    }

    const classInfo = this.classInfoOf(node, target.type.name, context)
    const slot = classInfo.vtable.indexOf(memberName)
    const method = this.findMethod(context, classInfo, memberName)

    if (slot === -1 || method === undefined) {
      throw new CompilerError(
        'invalid-operation',
        `Class '${classInfo.name}' has no method '${memberName}'.`,
        node,
      )
    }

    this.checkVisibility(node, method.visibility, classInfo.name, memberName, context)

    if (node.arguments.length !== method.signature.parameterTypes.length - 1) {
      throw new CompilerError(
        'type-mismatch',
        `Method '${memberName}' expects ${String(method.signature.parameterTypes.length - 1)} arguments.`,
        node,
      )
    }

    const vtablePointer = builder.load(
      'ptr',
      builder.fieldPointer(`%${classInfo.name}`, target.operand, 0),
    )
    const functionPointer = builder.load(
      'ptr',
      builder.elementPointer('ptr', vtablePointer, {
        kind: 'constant',
        type: 'i64',
        text: String(slot),
      }),
    )
    const args: CallArgument[] = [{ type: 'ptr', value: target.operand }]

    for (let index = 1; index < method.signature.parameterTypes.length; index++) {
      const parameterType = method.signature.parameterTypes[index]
      const argumentNode = node.arguments[index - 1]

      if (parameterType === undefined || argumentNode === undefined) {
        throw new CompilerError(
          'missing-annotation',
          `Argument ${String(index)} of '${memberName}' has no type.`,
          node,
        )
      }

      const result = this.generateExpression(argumentNode, builder, context)
      const adapted = this.adaptTo(node, result, parameterType, builder, context)

      args.push({ type: irTypeFromType(parameterType), value: adapted.operand })
    }

    const returned = builder.callValue(
      irTypeFromType(method.signature.returnType),
      functionPointer,
      args,
    )

    return {
      literalValue: undefined,
      operand: returned ?? { kind: 'constant', type: 'void', text: 'void' },
      type: method.signature.returnType,
    }
  }

  /**
   * Generates a call to the base class constructor.
   */
  private generateSuperConstructorCall(
    node: ts.CallExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    if (context.thisPointer === undefined || context.thisType === undefined) {
      throw new CompilerError('unsupported', 'Super outside of a class is not supported.', node)
    }

    const classInfo = this.classInfoOf(node, context.thisType, context)

    if (classInfo.base === undefined) {
      throw new CompilerError(
        'invalid-operation',
        `Class '${classInfo.name}' has no base class.`,
        node,
      )
    }

    const baseInfo = this.classInfoOf(node, classInfo.base, context)
    const constructorInfo = baseInfo.methods.get('constructor')

    if (constructorInfo === undefined) {
      throw new CompilerError(
        'invalid-operation',
        `Class '${baseInfo.name}' has no constructor.`,
        node,
      )
    }

    const args: CallArgument[] = [{ type: 'ptr', value: context.thisPointer }]
    const constructorArguments = node.arguments

    for (let index = 0; index < constructorInfo.signature.parameterTypes.length - 1; index++) {
      const parameterType = constructorInfo.signature.parameterTypes[index + 1]
      const argumentNode = constructorArguments[index]

      if (parameterType === undefined || argumentNode === undefined) {
        throw new CompilerError(
          'missing-annotation',
          `Argument ${String(index)} of the constructor has no type.`,
          node,
        )
      }

      const result = this.generateExpression(argumentNode, builder, context)
      const adapted = this.adaptTo(node, result, parameterType, builder, context)

      args.push({ type: irTypeFromType(parameterType), value: adapted.operand })
    }

    builder.call('void', constructorInfo.signature.name, args)

    return {
      literalValue: undefined,
      operand: { kind: 'constant', type: 'void', text: 'void' },
      type: voidType,
    }
  }

  /**
   * Generates a call to an external function through a global namespace.
   */
  private generateExternalCall(
    node: ts.CallExpression,
    access: ts.PropertyAccessExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    const namespace = access.expression

    if (!ts.isIdentifier(namespace)) {
      throw new CompilerError('unsupported', 'External calls require a simple namespace.', node)
    }

    const name = `${namespace.text}.${memberNameOf(access.name)}`
    const signature = context.functions.get(name)
    const builtin = context.builtins.get(name)

    if (builtin !== undefined) {
      return this.generateBuiltinCall(builtin, node, builder, context)
    }

    if (signature !== undefined) {
      if (node.arguments.length !== signature.parameterTypes.length) {
        throw new CompilerError(
          'type-mismatch',
          `Function '${name}' expects ${String(signature.parameterTypes.length)} arguments.`,
          node,
        )
      }

      const args = this.generateCallArguments(node, signature.parameterTypes, builder, context)
      const returned = builder.call(irTypeFromType(signature.returnType), name, args)

      return {
        literalValue: undefined,
        operand: returned ?? { kind: 'constant', type: 'void', text: 'void' },
        type: signature.returnType,
      }
    }

    // Undeclared namespace functions are treated as external symbols with pointer arguments.
    context.module.addDeclaration(`declare i32 @${name}(...)`)
    const args: CallArgument[] = []

    for (const argument of node.arguments) {
      const result = this.generateExpression(argument, builder, context)

      args.push({ type: irTypeFromType(result.type), value: result.operand })
    }

    const returned = builder.call('i32', name, args)

    return {
      literalValue: undefined,
      operand: returned ?? { kind: 'constant', type: 'void', text: 'void' },
      type: i32Type,
    }
  }

  /**
   * Returns the function type of the initializer of an object property, when it names a function.
   */
  private findFunctionInitializer(
    _node: ts.Node,
    target: ExpressionResult,
    memberName: string,
    context: GenerationContext,
    variableName: string | undefined,
  ): Type | undefined {
    if (target.type.kind !== 'object') {
      return undefined
    }

    const declaration = this.findObjectDeclaration(target, context, variableName)

    if (declaration === undefined) {
      return undefined
    }

    for (const property of declaration.properties) {
      if (!ts.isPropertyAssignment(property)) {
        continue
      }

      if (memberNameOf(property.name) !== memberName) {
        continue
      }

      if (!ts.isIdentifier(property.initializer)) {
        return undefined
      }

      const signature = context.functions.get(property.initializer.text)

      if (signature === undefined) {
        return undefined
      }

      return {
        kind: 'function',
        parameters: signature.parameterTypes.map((parameterType, index) => ({
          name: `p${String(index)}`,
          type: parameterType,
          optional: false,
        })),
        returnType: signature.returnType,
      }
    }

    return undefined
  }

  /**
   * Finds the object literal declaration that produced a value, when it is a direct variable.
   */
  private findObjectDeclaration(
    target: ExpressionResult,
    context: GenerationContext,
    variableName: string | undefined,
  ): ts.ObjectLiteralExpression | undefined {
    const direct = context.objectLiterals.get(target.operand)

    if (direct !== undefined) {
      return direct
    }

    if (variableName !== undefined) {
      return context.objectDeclarations.get(variableName)
    }

    return undefined
  }

  /**
   * Generates a call to a function stored in an object property.
   */
  private generateObjectMethodCall(
    node: ts.CallExpression,
    target: ExpressionResult,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    const access = node.expression

    if (!ts.isPropertyAccessExpression(access)) {
      throw new CompilerError('unsupported', 'Method calls require a member access.', node)
    }

    const memberName = memberNameOf(access.name)
    const objectType = target.type

    if (objectType.kind !== 'object') {
      throw new CompilerError('unsupported', 'Only object values support property calls.', node)
    }

    const properties = objectType.properties
    const index = properties.findIndex((property) => property.name === memberName)

    if (index === -1) {
      throw new CompilerError('unknown-name', `The object has no property '${memberName}'.`, node)
    }

    const property = properties[index]

    if (property === undefined) {
      throw new CompilerError('unknown-name', `The object has no property '${memberName}'.`, node)
    }

    let functionType = property.type

    if (functionType.kind !== 'function') {
      const initializer = this.findFunctionInitializer(
        node,
        target,
        memberName,
        context,
        ts.isIdentifier(access.expression) ? access.expression.text : undefined,
      )

      if (initializer === undefined) {
        throw new CompilerError(
          'type-mismatch',
          `Property '${memberName}' is not a function.`,
          node,
        )
      }

      functionType = initializer
    }

    if (functionType.kind !== 'function') {
      throw new CompilerError('type-mismatch', `Property '${memberName}' is not a function.`, node)
    }

    const offset =
      8 + properties.slice(0, index).reduce((total, candidate) => total + sizeOf(candidate.type), 0)
    const propertyPointer = builder.bytePointer(target.operand, {
      kind: 'constant',
      type: 'i64',
      text: String(offset),
    })
    const functionPointer = builder.load('ptr', propertyPointer)

    if (node.arguments.length !== functionType.parameters.length) {
      throw new CompilerError(
        'type-mismatch',
        `Function '${memberName}' expects ${String(functionType.parameters.length)} arguments.`,
        node,
      )
    }

    const args: CallArgument[] = []

    node.arguments.forEach((argumentNode, argumentIndex) => {
      const parameter = functionType.parameters[argumentIndex]

      if (parameter === undefined) {
        throw new CompilerError(
          'type-mismatch',
          `Argument ${String(argumentIndex)} of '${memberName}' has no type.`,
          node,
        )
      }

      const result = this.generateExpression(argumentNode, builder, context)
      const adapted = this.adaptTo(node, result, parameter.type, builder, context)

      args.push({ type: irTypeFromType(parameter.type), value: adapted.operand })
    })

    const returned = builder.callValue(
      irTypeFromType(functionType.returnType),
      functionPointer,
      args,
    )

    return {
      literalValue: undefined,
      operand: returned ?? { kind: 'constant', type: 'void', text: 'void' },
      type: functionType.returnType,
    }
  }

  /**
   * Generates a call to a base class method.
   */
  private generateSuperCall(
    access: ts.PropertyAccessExpression,
    node: ts.CallExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    if (context.thisPointer === undefined || context.thisType === undefined) {
      throw new CompilerError('unsupported', 'Super outside of a class is not supported.', node)
    }

    const classInfo = this.classInfoOf(node, context.thisType, context)

    if (classInfo.base === undefined) {
      throw new CompilerError(
        'invalid-operation',
        `Class '${classInfo.name}' has no base class.`,
        node,
      )
    }

    const baseInfo = this.classInfoOf(node, classInfo.base, context)
    const memberName = memberNameOf(access.name)
    const method = this.findMethod(context, baseInfo, memberName)

    if (method === undefined) {
      throw new CompilerError(
        'invalid-operation',
        `Class '${baseInfo.name}' has no method '${memberName}'.`,
        node,
      )
    }

    if (node.arguments.length !== method.signature.parameterTypes.length - 1) {
      throw new CompilerError(
        'type-mismatch',
        `Method '${memberName}' expects ${String(method.signature.parameterTypes.length - 1)} arguments.`,
        node,
      )
    }

    const args: CallArgument[] = [{ type: 'ptr', value: context.thisPointer }]

    for (let index = 1; index < method.signature.parameterTypes.length; index++) {
      const parameterType = method.signature.parameterTypes[index]
      const argumentNode = node.arguments[index - 1]

      if (parameterType === undefined || argumentNode === undefined) {
        throw new CompilerError(
          'missing-annotation',
          `Argument ${String(index)} of '${memberName}' has no type.`,
          node,
        )
      }

      const result = this.generateExpression(argumentNode, builder, context)
      const adapted = this.adaptTo(node, result, parameterType, builder, context)

      args.push({ type: irTypeFromType(parameterType), value: adapted.operand })
    }

    const returned = builder.call(
      irTypeFromType(method.signature.returnType),
      method.signature.name,
      args,
    )

    return {
      literalValue: undefined,
      operand: returned ?? { kind: 'constant', type: 'void', text: 'void' },
      type: method.signature.returnType,
    }
  }

  /**
   * Generates an array element access, such as `items[0]`.
   */
  private generateElementAccess(
    node: ts.ElementAccessExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    const address = this.generateElementAddress(node, builder, context)

    return {
      literalValue: undefined,
      operand: builder.load(irTypeFromType(address.type), address.pointer),
      type: address.type,
    }
  }

  /**
   * Resolves the storage of an array element access, with a bounds check.
   */
  private generateElementAddress(
    node: ts.ElementAccessExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): { pointer: LlvmLocal; type: Type } {
    const array = this.generateExpression(node.expression, builder, context)

    if (!isArrayType(array.type)) {
      throw new CompilerError('type-mismatch', 'Indexing requires an array.', node)
    }

    const index = this.generateExpression(node.argumentExpression, builder, context)

    if (!isIntegerType(index.type)) {
      throw new CompilerError('type-mismatch', 'Array indices must be integers.', node)
    }

    const index64 = this.widenToI64(node, index, builder)
    const elementType = array.type.elementType
    this.generateBoundsCheck(array.operand, index64.operand, builder, context)

    return {
      pointer: this.elementAddress(array.operand, index64.operand, elementType, builder),
      type: elementType,
    }
  }

  /**
   * Generates an array literal allocated by the garbage collector.
   */
  private generateArrayLiteral(
    node: ts.ArrayLiteralExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    if (node.elements.length === 0) {
      throw new CompilerError('type-mismatch', 'Cannot infer the type of an empty array.', node)
    }

    const elements: ExpressionResult[] = []
    let elementType: Type | undefined

    for (const element of node.elements) {
      const result = this.generateExpression(element, builder, context)

      if (elementType === undefined) {
        elementType = result.type
        elements.push(result)

        continue
      }

      elements.push(this.adaptTo(node, result, elementType, builder, context))
    }

    if (elementType === undefined) {
      throw new CompilerError('type-mismatch', 'Cannot infer the type of an empty array.', node)
    }

    const bytes = 8 + elements.length * sizeOf(elementType)
    const pointer = this.gcAlloc(node, bytes, builder, context)

    builder.store('i64', { kind: 'constant', type: 'i64', text: String(elements.length) }, pointer)

    elements.forEach((element, index) => {
      const elementPointer = builder.bytePointer(pointer, {
        kind: 'constant',
        type: 'i64',
        text: String(8 + index * sizeOf(elementType)),
      })

      builder.store(irTypeFromType(elementType), element.operand, elementPointer)
    })

    return {
      literalValue: undefined,
      operand: pointer,
      type: { kind: 'array', elementType },
    }
  }

  /**
   * Generates an object literal allocated by the garbage collector.
   */
  private generateObjectLiteral(
    node: ts.ObjectLiteralExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    const properties: { name: string; result: ExpressionResult }[] = []

    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        throw new CompilerError(
          'unsupported',
          'Object literals only support plain properties.',
          property,
        )
      }

      const name = this.propertyKeyOf(property.name, builder, context)

      if (
        ts.isIdentifier(property.initializer) &&
        this.lookupVariableSafe(property.initializer, property.initializer.text, context) ===
          undefined &&
        context.functions.has(property.initializer.text)
      ) {
        properties.push({
          name,
          result: {
            literalValue: undefined,
            operand: { kind: 'constant', type: 'ptr', text: 'null' },
            type: unknownType,
          },
        })

        continue
      }

      const result = this.generateExpression(property.initializer, builder, context)

      properties.push({ name, result })
    }

    if (properties.length === 0) {
      throw new CompilerError('unsupported', 'Empty object literals are not supported.', node)
    }

    const first = properties[0]

    if (first === undefined) {
      throw new CompilerError('unsupported', 'Empty object literals are not supported.', node)
    }

    const valueType = first.result.type

    for (const property of properties) {
      if (!sameType(property.result.type, valueType)) {
        throw new CompilerError(
          'type-mismatch',
          `Object literal properties must have the same type: '${property.name}' is ${describeType(property.result.type)}.`,
          property.result.operand.kind === 'constant' ? node : node,
        )
      }
    }

    const bytes = 8 + properties.length * sizeOf(valueType)
    const pointer = this.gcAlloc(node, bytes, builder, context)

    builder.store(
      'i64',
      { kind: 'constant', type: 'i64', text: String(properties.length) },
      pointer,
    )

    properties.forEach((property, index) => {
      const propertyPointer = builder.bytePointer(pointer, {
        kind: 'constant',
        type: 'i64',
        text: String(8 + index * sizeOf(valueType)),
      })

      builder.store(irTypeFromType(valueType), property.result.operand, propertyPointer)
    })

    const objectType: Type = {
      kind: 'object',
      properties: properties.map((property) => ({
        name: property.name,
        type: property.result.type,
        optional: false,
      })),
    }

    context.objectLiterals.set(pointer, node)

    return {
      literalValue: undefined,
      operand: pointer,
      type: objectType,
    }
  }

  /**
   * Looks up a variable without failing, returning its slot when found.
   */
  private lookupVariableSafe(
    _node: ts.Node,
    name: string,
    context: GenerationContext,
  ): VariableSlot | undefined {
    for (let index = context.scopes.length - 1; index >= 0; index--) {
      const slot = context.scopes[index]?.get(name)

      if (slot !== undefined) {
        return slot
      }
    }

    if (context.globals.has(name)) {
      return { pointer: { kind: 'global', name }, type: unknownType }
    }

    return undefined
  }

  /**
   * Determines whether a name refers to a global variable.
   */
  private isGlobalVariable(name: string, context: GenerationContext): boolean {
    return context.globals.has(name)
  }

  /**
   * Reads the name of an object literal property, evaluating computed string keys.
   */
  private propertyKeyOf(
    name: ts.PropertyName,
    builder: LlvmFunction,
    context: GenerationContext,
  ): string {
    if (!ts.isComputedPropertyName(name)) {
      return memberNameOf(name)
    }

    const expression = name.expression

    if (ts.isPropertyAccessExpression(expression)) {
      const memberName = memberNameOf(expression.name)

      if (
        ts.isIdentifier(expression.expression) &&
        (context.globals.has(expression.expression.text) ||
          this.lookupVariableSafe(expression.expression, expression.expression.text, context) !==
            undefined)
      ) {
        return memberName
      }

      const target = this.generateExpression(expression.expression, builder, context)

      if (target.type.kind === 'reference' && ts.isIdentifier(expression.expression)) {
        const classInfo = this.classInfoOf(undefined, target.type.name, context)
        const field = classInfo.allFields.find((candidate) => candidate.name === memberName)

        if (field?.type.kind === 'literal' && typeof field.type.value === 'string') {
          return field.type.value
        }
      }

      if (target.type.kind === 'unknown') {
        return memberName
      }
    }

    throw new CompilerError(
      'unsupported',
      'Computed keys must reference a constant string property.',
      name,
    )
  }

  /**
   * Generates a class instantiation.
   */
  private generateNew(
    node: ts.NewExpression,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    if (!ts.isIdentifier(node.expression)) {
      throw new CompilerError('unsupported', 'Only direct class instantiation is supported.', node)
    }

    const className = node.expression.text
    const classInfo = this.classInfoOf(node, className, context)
    const bytes = 8 + classInfo.allFields.reduce((total, field) => total + sizeOf(field.type), 0)
    const pointer = this.gcAlloc(node, bytes, builder, context)

    builder.store('ptr', { kind: 'global', name: `${className}.vt` }, pointer)

    for (const field of classInfo.allFields) {
      const fieldPointer = builder.fieldPointer(`%${className}`, pointer, field.index)

      builder.store(irTypeFromType(field.type), this.zeroValueOf(field.type), fieldPointer)
    }

    const constructorInfo = classInfo.methods.get('constructor')

    if (constructorInfo !== undefined) {
      const declaration = findMethodDeclaration(context, className, 'constructor')

      if (declaration === undefined || !ts.isConstructorDeclaration(declaration)) {
        throw new CompilerError(
          'invalid-operation',
          `Constructor of class '${className}' is missing.`,
          node,
        )
      }

      const previousThisPointer = context.thisPointer
      const previousThisType = context.thisType

      context.thisPointer = pointer
      context.thisType = className

      const classDeclaration = context.sourceClasses.get(className)

      if (classDeclaration === undefined) {
        throw new CompilerError('invalid-operation', `Class '${className}' is missing.`, node)
      }

      for (const field of classInfo.fields) {
        const property = classDeclaration.members.find(
          (member) => ts.isPropertyDeclaration(member) && memberNameOf(member.name) === field.name,
        )

        if (
          property !== undefined &&
          ts.isPropertyDeclaration(property) &&
          property.initializer !== undefined
        ) {
          const initializer = this.generateExpression(property.initializer, builder, context)
          const adapted = this.adaptTo(
            property.initializer,
            initializer,
            field.type,
            builder,
            context,
          )
          const fieldPointer = builder.fieldPointer(`%${className}`, pointer, field.index)

          builder.store(irTypeFromType(field.type), adapted.operand, fieldPointer)
        }
      }

      const args: CallArgument[] = [{ type: 'ptr', value: pointer }]
      const constructorArguments = node.arguments ?? []

      for (let index = 0; index < constructorInfo.signature.parameterTypes.length - 1; index++) {
        const parameterType = constructorInfo.signature.parameterTypes[index + 1]
        const argumentNode = constructorArguments[index]

        if (parameterType === undefined || argumentNode === undefined) {
          throw new CompilerError(
            'missing-annotation',
            `Argument ${String(index)} of the constructor has no type.`,
            node,
          )
        }

        const result = this.generateExpression(argumentNode, builder, context)
        const adapted = this.adaptTo(node, result, parameterType, builder, context)

        args.push({ type: irTypeFromType(parameterType), value: adapted.operand })
      }

      builder.call('void', constructorInfo.signature.name, args)
      context.thisPointer = previousThisPointer
      context.thisType = previousThisType
    }

    return {
      literalValue: undefined,
      operand: pointer,
      type: { kind: 'reference', name: className, typeArguments: [] },
    }
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

    if (!isBooleanType(condition.type)) {
      throw new CompilerError(
        'type-mismatch',
        'Conditional expressions require a boolean condition.',
        node,
      )
    }

    const trueLabel = builder.reserveLabel('cond.true')
    const falseLabel = builder.reserveLabel('cond.false')
    const endLabel = builder.reserveLabel('cond.end')

    builder.branch(condition.operand, trueLabel, falseLabel)

    builder.startBlock(trueLabel)
    const trueResult = this.generateExpression(node.whenTrue, builder, context)

    if (trueResult.type.kind === 'void') {
      throw new CompilerError('type-mismatch', 'Conditional expressions cannot produce void.', node)
    }

    const trueType = trueResult.type
    const temp = builder.alloca(irTypeFromType(trueType), 'cond')

    builder.store(irTypeFromType(trueType), trueResult.operand, temp)
    builder.jump(endLabel)

    builder.startBlock(falseLabel)
    const falseResult = this.generateExpression(node.whenFalse, builder, context)

    if (!sameType(falseResult.type, trueType)) {
      throw new CompilerError(
        'type-mismatch',
        'Conditional expression branches must have the same type.',
        node,
      )
    }

    builder.store(irTypeFromType(trueType), falseResult.operand, temp)
    builder.jump(endLabel)
    builder.startBlock(endLabel)

    return {
      literalValue: undefined,
      operand: builder.load(irTypeFromType(trueType), temp),
      type: trueType,
    }
  }

  /**
   * Generates the check that a division operand is not zero.
   */
  private generateDivisionCheck(
    value: ExpressionResult,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    const panicLabel = builder.reserveLabel('div.panic')
    const okLabel = builder.reserveLabel('div.ok')
    const zero = builder.binary(irTypeFromType(value.type), 'icmp eq', value.operand, {
      kind: 'constant',
      type: irTypeFromType(value.type),
      text: '0',
    })

    builder.branch(zero, panicLabel, okLabel)
    builder.startBlock(panicLabel)
    this.panic('division by zero', builder, context)
    builder.startBlock(okLabel)
  }

  /**
   * Generates the check that an array index is within bounds.
   */
  private generateBoundsCheck(
    array: LlvmOperand,
    index: LlvmOperand,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    const length = builder.load('i64', array)
    const panicLabel = builder.reserveLabel('bounds.panic')
    const okLabel = builder.reserveLabel('bounds.ok')
    const outOfBounds = builder.binary('i64', 'icmp uge', index, length)

    builder.branch(outOfBounds, panicLabel, okLabel)
    builder.startBlock(panicLabel)
    this.panic('index out of bounds', builder, context)
    builder.startBlock(okLabel)
  }

  /**
   * Loads an array element without a bounds check.
   */
  private loadArrayElement(
    array: LlvmOperand,
    index: LlvmOperand,
    elementType: Type,
    builder: LlvmFunction,
  ): LlvmLocal {
    const pointer = this.elementAddress(array, index, elementType, builder)

    return builder.load(irTypeFromType(elementType), pointer)
  }

  /**
   * Returns the storage of an array element.
   */
  private elementAddress(
    array: LlvmOperand,
    index: LlvmOperand,
    elementType: Type,
    builder: LlvmFunction,
  ): LlvmLocal {
    const offset = builder.binary('i64', 'mul', index, {
      kind: 'constant',
      type: 'i64',
      text: String(sizeOf(elementType)),
    })
    const base = builder.binary('i64', 'add', offset, { kind: 'constant', type: 'i64', text: '8' })

    return builder.bytePointer(array, base)
  }

  /**
   * Returns the storage of the length of an array.
   */
  private lengthAddress(array: LlvmOperand, builder: LlvmFunction): LlvmLocal {
    return builder.bytePointer(array, { kind: 'constant', type: 'i64', text: '0' })
  }

  /**
   * Concatenates two strings into a new garbage collected string.
   */
  private concatenateStrings(
    _node: ts.Node,
    left: ExpressionResult,
    right: ExpressionResult,
    builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    context.module.addDeclaration('declare i64 @strlen(ptr)')
    context.module.addDeclaration('declare void @llvm.memcpy.p0.p0.i64(ptr, ptr, i64, i1)')

    const leftLength = builder.call('i64', 'strlen', [{ type: 'ptr', value: left.operand }])
    const rightLength = builder.call('i64', 'strlen', [{ type: 'ptr', value: right.operand }])

    if (leftLength === undefined || rightLength === undefined) {
      throw new Error('The string lengths are missing.')
    }

    const total = builder.binary(
      'i64',
      'add',
      builder.binary('i64', 'add', leftLength, rightLength),
      { kind: 'constant', type: 'i64', text: '1' },
    )
    const pointer = builder.call('ptr', 'GC_malloc', [{ type: 'i64', value: total }])

    if (pointer === undefined) {
      throw new Error('The string allocation failed.')
    }

    builder.call('void', 'llvm.memcpy.p0.p0.i64', [
      { type: 'ptr', value: pointer },
      { type: 'ptr', value: left.operand },
      { type: 'i64', value: leftLength },
      { type: 'i1', value: { kind: 'constant', type: 'i1', text: '0' } },
    ])
    const rightTarget = builder.bytePointer(pointer, leftLength)
    builder.call('void', 'llvm.memcpy.p0.p0.i64', [
      { type: 'ptr', value: rightTarget },
      { type: 'ptr', value: right.operand },
      { type: 'i64', value: rightLength },
      { type: 'i1', value: { kind: 'constant', type: 'i1', text: '0' } },
    ])
    const terminator = builder.binary('i64', 'add', total, {
      kind: 'constant',
      type: 'i64',
      text: '-1',
    })
    const terminatorPointer = builder.bytePointer(pointer, terminator)
    builder.store('i8', { kind: 'constant', type: 'i8', text: '0' }, terminatorPointer)

    return { literalValue: undefined, operand: pointer, type: stringType }
  }

  /**
   * Widens an integer to i64, preserving signedness.
   */
  private widenToI64(
    _node: ts.Node,
    result: ExpressionResult,
    builder: LlvmFunction,
  ): ExpressionResult {
    if (
      result.type.kind === 'primitive' &&
      (result.type.name === 'i64' || result.type.name === 'usize')
    ) {
      return result
    }

    if (isSignedInteger(result.type)) {
      return {
        literalValue: result.literalValue,
        operand: builder.cast('sext', irTypeFromType(result.type), result.operand, 'i64'),
        type: i64Type,
      }
    }

    if (isUnsignedInteger(result.type)) {
      return {
        literalValue: result.literalValue,
        operand: builder.cast('zext', irTypeFromType(result.type), result.operand, 'i64'),
        type: usizeType,
      }
    }

    throw new Error('The value must be an integer.')
  }

  /**
   * Widens an integer to i32 for variadic calls.
   */
  private widenToI32(
    _node: ts.Node,
    result: ExpressionResult,
    builder: LlvmFunction,
  ): ExpressionResult {
    if (result.type.kind === 'primitive' && result.type.name === 'i32') {
      return result
    }

    if (isSignedInteger(result.type)) {
      return {
        literalValue: result.literalValue,
        operand: builder.cast('sext', irTypeFromType(result.type), result.operand, 'i32'),
        type: i32Type,
      }
    }

    return {
      literalValue: result.literalValue,
      operand: builder.cast('zext', irTypeFromType(result.type), result.operand, 'i32'),
      type: u32Type,
    }
  }

  /**
   * Converts a value to the target type with an explicit cast.
   */
  private castTo(
    _node: ts.Node,
    result: ExpressionResult,
    targetType: Type,
    builder: LlvmFunction,
  ): ExpressionResult {
    if (sameType(result.type, targetType)) {
      return result
    }

    const source = result.type
    const sourceIr = irTypeFromType(source)
    const targetIr = irTypeFromType(targetType)

    if (isBooleanType(source) && isIntegerType(targetType)) {
      const widened = builder.cast('zext', 'i1', result.operand, targetIr)

      return { literalValue: undefined, operand: widened, type: targetType }
    }

    if (isIntegerType(source) && isBooleanType(targetType)) {
      const compared = builder.binary(
        sourceIr,
        isUnsignedInteger(source) ? 'icmp ne' : 'icmp ne',
        result.operand,
        { kind: 'constant', type: sourceIr, text: '0' },
      )

      return { literalValue: undefined, operand: compared, type: booleanType }
    }

    if (isIntegerType(source) && isIntegerType(targetType)) {
      const opcode = integerCastOpcode(source, targetType)

      if (opcode === undefined) {
        return { literalValue: undefined, operand: result.operand, type: targetType }
      }

      return {
        literalValue: undefined,
        operand: builder.cast(opcode, sourceIr, result.operand, targetIr),
        type: targetType,
      }
    }

    if (isIntegerType(source) && isFloatType(targetType)) {
      const opcode = isSignedInteger(source) ? 'sitofp' : 'uitofp'

      return {
        literalValue: undefined,
        operand: builder.cast(opcode, sourceIr, result.operand, targetIr),
        type: targetType,
      }
    }

    if (isFloatType(source) && isIntegerType(targetType)) {
      const opcode = isSignedInteger(targetType) ? 'fptosi' : 'fptoui'

      return {
        literalValue: undefined,
        operand: builder.cast(opcode, sourceIr, result.operand, targetIr),
        type: targetType,
      }
    }

    if (isFloatType(source) && isFloatType(targetType)) {
      const opcode = source.name === 'f32' ? 'fpext' : 'fptrunc'

      return {
        literalValue: undefined,
        operand: builder.cast(opcode, sourceIr, result.operand, targetIr),
        type: targetType,
      }
    }

    throw new CompilerError(
      'type-mismatch',
      `Cannot cast ${describeType(source)} to ${describeType(targetType)}.`,
      _node,
    )
  }

  /**
   * Adapts a value to the target type, allowing literal narrowing and class upcasts.
   */
  private adaptTo(
    node: ts.Node,
    result: ExpressionResult,
    targetType: Type,
    _builder: LlvmFunction,
    context: GenerationContext,
  ): ExpressionResult {
    if (sameType(result.type, targetType)) {
      return result
    }

    if (result.literalValue !== undefined && isNumericType(targetType)) {
      if (fitsLiteral(result.literalValue, targetType)) {
        return numericLiteralResultFor(result.literalValue, targetType)
      }

      throw new CompilerError(
        'literal-overflow',
        `The literal ${String(result.literalValue)} does not fit in ${describeType(targetType)}.`,
        node,
        `Use a type that fits the value, such as 'i32' or 'i64'.`,
      )
    }

    if (
      isReferenceType(result.type) &&
      isReferenceType(targetType) &&
      isSubclassOf(context, result.type.name, targetType.name)
    ) {
      return { literalValue: undefined, operand: result.operand, type: targetType }
    }

    throw new CompilerError(
      'type-mismatch',
      `Cannot assign a value of type '${describeType(result.type)}' to '${describeType(targetType)}'.`,
      node,
      `Use a value of type '${describeType(targetType)}' or cast with 'as ${describeType(targetType)}'.`,
    )
  }

  /**
   * Allocates garbage collected memory.
   */
  private gcAlloc(
    _node: ts.Node,
    bytes: number,
    builder: LlvmFunction,
    context: GenerationContext,
  ): LlvmLocal {
    context.module.addDeclaration('declare ptr @GC_malloc(i64)')
    const pointer = builder.call('ptr', 'GC_malloc', [
      { type: 'i64', value: { kind: 'constant', type: 'i64', text: String(bytes) } },
    ])

    if (pointer === undefined) {
      throw new Error('The allocation failed.')
    }

    return pointer
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
   * Aborts the program with a panic message.
   */
  private panic(message: string, builder: LlvmFunction, context: GenerationContext): void {
    context.module.addDeclaration('declare i32 @fprintf(ptr, ...)')
    context.module.addDeclaration('declare void @exit(i32)')
    context.module.addDeclaration('@stderr = external global ptr')

    if (!context.panicEmitted) {
      context.panicEmitted = true

      const panicBuilder = context.module.addFunction(
        { name: 'livescript.panic', parameterTypes: [stringType], returnType: voidType },
        ['message'],
      )
      const stderr = panicBuilder.load('ptr', { kind: 'global', name: 'stderr' })
      const formatPointer = this.stringPointer('panic: %s\n', panicBuilder, context)

      panicBuilder.call(
        'i32',
        'printf',
        [
          { type: 'ptr', value: stderr },
          { type: 'ptr', value: formatPointer },
          { type: 'ptr', value: { kind: 'local', name: 'message' } },
        ],
        'ptr, ...',
      )
      panicBuilder.call('void', 'exit', [
        { type: 'i32', value: { kind: 'constant', type: 'i32', text: '101' } },
      ])
      panicBuilder.unreachable()
    }

    const messagePointer = this.stringPointer(message, builder, context)

    builder.call('void', 'livescript.panic', [{ type: 'ptr', value: messagePointer }])
    builder.unreachable()
  }

  /**
   * Fails when a member is not visible from the current class.
   */
  private checkVisibility(
    node: ts.Node,
    visibility: MemberVisibility,
    owner: string,
    memberName: string,
    context: GenerationContext,
  ): void {
    if (visibility === 'public') {
      return
    }

    const currentClass = context.thisType

    if (visibility === 'private' && currentClass !== owner) {
      throw new CompilerError(
        'visibility',
        `Field '${memberName}' is private to class '${owner}'.`,
        node,
        `Access '${memberName}' from inside class '${owner}' or make it public.`,
      )
    }

    if (
      visibility === 'protected' &&
      (currentClass === undefined || !isSubclassOf(context, currentClass, owner))
    ) {
      throw new CompilerError(
        'visibility',
        `Field '${memberName}' is protected in class '${owner}'.`,
        node,
        `Access '${memberName}' from a subclass of '${owner}' or make it public.`,
      )
    }
  }

  /**
   * Returns the default value of a type for uninitialized variables.
   */
  private defaultValueOf(_node: ts.Node, type: Type): LlvmOperand {
    if (isReferenceType(type) || isStringType(type)) {
      return this.zeroValueOf(type)
    }

    if (isNumericType(type) || isBooleanType(type)) {
      return this.zeroValueOf(type)
    }

    throw new Error(`Variables of type '${describeType(type)}' require an initializer.`)
  }

  /**
   * Returns the zero value of a type.
   */
  private zeroValueOf(type: Type): LlvmOperand {
    if (isStringType(type) || isReferenceType(type) || isArrayType(type)) {
      return { kind: 'constant', type: 'ptr', text: 'null' }
    }

    return { kind: 'constant', type: irTypeFromType(type), text: '0' }
  }

  /**
   * Declares a variable in the current scope.
   */
  private declareVariable(
    name: string,
    pointer: LlvmLocal,
    type: Type,
    context: GenerationContext,
  ): void {
    const scope = context.scopes[context.scopes.length - 1]

    if (scope === undefined) {
      throw new Error('No scope is being generated.')
    }

    scope.set(name, { pointer, type })
  }

  /**
   * Looks up a variable in the scope chain.
   */
  private lookupVariable(_node: ts.Node, name: string, context: GenerationContext): VariableSlot {
    for (let index = context.scopes.length - 1; index >= 0; index--) {
      const slot = context.scopes[index]?.get(name)

      if (slot !== undefined) {
        return slot
      }
    }

    if (context.globals.has(name)) {
      context.module.addDeclaration(`@${name} = external global ptr`)

      return { pointer: { kind: 'global', name }, type: unknownType }
    }

    throw new CompilerError('unknown-name', `Unknown variable '${name}'.`, undefined)
  }

  /**
   * Returns the information of a class, failing when it is unknown.
   */
  private classInfoOf(
    _node: ts.Node | undefined,
    name: string,
    context: GenerationContext,
  ): ClassInfo {
    const classInfo = context.classes.get(name)

    if (classInfo === undefined) {
      throw new Error(`Unknown class '${name}'.`)
    }

    return classInfo
  }

  /**
   * Finds a method in a class or any of its base classes.
   */
  private findMethod(
    context: GenerationContext,
    classInfo: ClassInfo,
    methodName: string,
  ): MethodInfo | undefined {
    let current: ClassInfo | undefined = classInfo

    while (current !== undefined) {
      const method = current.methods.get(methodName)

      if (method !== undefined) {
        return method
      }

      current =
        current.base === undefined ? undefined : this.classInfoOf(undefined, current.base, context)
    }

    return undefined
  }

  /**
   * Registers a loop, binding the pending label when there is one.
   */
  private enterLoop(loop: LoopContext, context: GenerationContext): void {
    context.loops.push(loop)

    if (context.pendingLabel !== undefined) {
      context.labels.set(context.pendingLabel, loop)
    }
  }

  /**
   * Unregisters the loop being generated.
   */
  private exitLoop(context: GenerationContext): void {
    context.loops.pop()

    if (context.pendingLabel !== undefined) {
      context.labels.delete(context.pendingLabel)
      context.pendingLabel = undefined
    }
  }

  /**
   * Returns the loop that a break or continue refers to.
   */
  private loopOf(
    _node: ts.Node,
    labelText: string | undefined,
    context: GenerationContext,
  ): LoopContext | undefined {
    if (labelText !== undefined) {
      const labeled = context.labels.get(labelText)

      if (labeled === undefined) {
        throw new Error(`Unknown label '${labelText}'.`)
      }

      return labeled
    }

    return context.loops[context.loops.length - 1]
  }

  /**
   * Pushes a jump buffer onto the handler stack.
   */
  private pushHandler(
    buffer: LlvmLocal,
    baseCount: LlvmLocal,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    context.module.addGlobal('@livescript.handlers = global [64 x ptr] zeroinitializer')
    context.module.addGlobal('@livescript.handler_count = global i64 zeroinitializer')

    const count = builder.load('i64', { kind: 'global', name: 'livescript.handler_count' })
    const slot = builder.elementPointer(
      'ptr',
      { kind: 'global', name: 'livescript.handlers' },
      count,
    )
    const slotPointer = slot

    builder.store('ptr', buffer, slotPointer)
    builder.store(
      'i64',
      builder.binary('i64', 'add', count, { kind: 'constant', type: 'i64', text: '1' }),
      { kind: 'global', name: 'livescript.handler_count' },
    )
    builder.store('i64', count, baseCount)
  }

  /**
   * Removes the innermost handler from the handler stack.
   */
  private popHandler(builder: LlvmFunction, context: GenerationContext): void {
    context.module.addGlobal('@livescript.handler_count = global i64 zeroinitializer')

    const count = builder.load('i64', { kind: 'global', name: 'livescript.handler_count' })

    builder.store(
      'i64',
      builder.binary('i64', 'sub', count, { kind: 'constant', type: 'i64', text: '1' }),
      { kind: 'global', name: 'livescript.handler_count' },
    )
  }

  /**
   * Restores the handler stack to the count recorded when a try started.
   */
  private restoreHandlers(
    baseCount: LlvmLocal,
    builder: LlvmFunction,
    context: GenerationContext,
  ): void {
    context.module.addGlobal('@livescript.handler_count = global i64 zeroinitializer')
    const count = builder.load('i64', baseCount)

    builder.store('i64', count, { kind: 'global', name: 'livescript.handler_count' })
  }

  /**
   * Pops every handler of the current function, for returns that leave try regions.
   */
  private exitHandlers(context: GenerationContext, builder: LlvmFunction): void {
    for (let index = 0; index < context.handlerDepth; index++) {
      this.popHandler(builder, context)
    }
  }

  /**
   * Pops the handlers pushed inside the loop that a break or continue exits to.
   */
  private exitToLoop(loop: LoopContext, context: GenerationContext, builder: LlvmFunction): void {
    for (let index = 0; index < context.handlerDepth - loop.handlerDepth; index++) {
      this.popHandler(builder, context)
    }
  }
}

/**
 * Creates the result of a numeric literal, widening integers that do not fit in i32.
 */
function numericLiteralResult(value: number): ExpressionResult {
  if (!Number.isInteger(value)) {
    return {
      literalValue: value,
      operand: { kind: 'constant', type: 'double', text: formatDouble(value) },
      type: f64Type,
    }
  }

  if (value < -2147483648 || value > 2147483647) {
    return {
      literalValue: value,
      operand: { kind: 'constant', type: 'i64', text: String(value) },
      type: i64Type,
    }
  }

  return {
    literalValue: value,
    operand: { kind: 'constant', type: 'i32', text: String(value) },
    type: i32Type,
  }
}

/**
 * Creates the result of a numeric literal adapted to a concrete type.
 */
function numericLiteralResultFor(value: number, type: Type): ExpressionResult {
  const irType = irTypeFromType(type)

  if (type.kind === 'primitive' && type.name === 'f32') {
    return {
      literalValue: value,
      operand: { kind: 'constant', type: irType, text: formatDouble(Math.fround(value)) },
      type,
    }
  }

  if (isFloatType(type)) {
    return {
      literalValue: value,
      operand: { kind: 'constant', type: irType, text: formatDouble(value) },
      type,
    }
  }

  return {
    literalValue: value,
    operand: { kind: 'constant', type: irType, text: String(value) },
    type,
  }
}

/**
 * Determines whether a literal value fits in a numeric type.
 */
function fitsLiteral(value: number, type: Type): boolean {
  if (type.kind !== 'primitive') {
    return false
  }

  if (type.name === 'i8') {
    return Number.isInteger(value) && value >= -128 && value <= 127
  }

  if (type.name === 'i16') {
    return Number.isInteger(value) && value >= -32768 && value <= 32767
  }

  if (type.name === 'i32') {
    return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
  }

  if (type.name === 'i64') {
    return Number.isInteger(value)
  }

  if (type.name === 'u8') {
    return Number.isInteger(value) && value >= 0 && value <= 255
  }

  if (type.name === 'u16') {
    return Number.isInteger(value) && value >= 0 && value <= 65535
  }

  if (type.name === 'u32') {
    return Number.isInteger(value) && value >= 0 && value <= 4294967295
  }

  if (type.name === 'u64' || type.name === 'usize') {
    return Number.isInteger(value) && value >= 0
  }

  return false
}

/**
 * Compares two types structurally.
 */
function sameType(a: Type, b: Type): boolean {
  if (a.kind !== b.kind) {
    return false
  }

  if (a.kind === 'primitive' && b.kind === 'primitive') {
    return a.name === b.name
  }

  if (a.kind === 'reference' && b.kind === 'reference') {
    return a.name === b.name
  }

  if (a.kind === 'array' && b.kind === 'array') {
    return sameType(a.elementType, b.elementType)
  }

  if (a.kind === 'literal' && b.kind === 'literal') {
    return a.primitive === b.primitive && a.value === b.value
  }

  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Describes a type for error messages.
 */
function describeType(type: Type): string {
  if (type.kind === 'primitive' || type.kind === 'reference') {
    return type.name
  }

  if (type.kind === 'array') {
    return `${describeType(type.elementType)}[]`
  }

  return type.kind
}

/**
 * Determines whether a class is a subclass of another one.
 */
function isSubclassOf(context: GenerationContext, className: string, baseName: string): boolean {
  let current: string | undefined = className

  while (current !== undefined) {
    if (current === baseName) {
      return true
    }

    current = context.classes.get(current)?.base
  }

  return false
}

/**
 * Returns the widest of two integer types, unsigned when either is unsigned.
 */
function commonIntegerTypeOf(left: Type, right: Type): Type | undefined {
  const size = Math.max(sizeOf(left), sizeOf(right))
  const unsigned = isUnsignedInteger(left) || isUnsignedInteger(right)

  if (size === 1) {
    return unsigned ? u8Type : i8Type
  }

  if (size === 2) {
    return unsigned ? u16Type : i16Type
  }

  if (size === 4) {
    return unsigned ? u32Type : i32Type
  }

  if (size === 8) {
    return unsigned ? usizeType : i64Type
  }

  return undefined
}

/**
 * Returns the cast opcode between two integer types, or `undefined` when the bits match.
 */
function integerCastOpcode(source: Type, target: Type): string | undefined {
  const sourceSize = sizeOf(source)
  const targetSize = sizeOf(target)

  if (sourceSize === targetSize) {
    return undefined
  }

  if (targetSize > sourceSize) {
    return isSignedInteger(source) ? 'sext' : 'zext'
  }

  return 'trunc'
}

/**
 * Returns the arithmetic opcode of an operator for the given type.
 */
function arithmeticOpcodeOf(operator: ts.SyntaxKind, type: Type): string | undefined {
  if (isFloatType(type)) {
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

    return undefined
  }

  if (operator === ts.SyntaxKind.PlusToken) {
    return 'add'
  }

  if (operator === ts.SyntaxKind.MinusToken) {
    return 'sub'
  }

  if (operator === ts.SyntaxKind.AsteriskToken) {
    return 'mul'
  }

  if (operator === ts.SyntaxKind.SlashToken) {
    return isUnsignedInteger(type) ? 'udiv' : 'sdiv'
  }

  if (operator === ts.SyntaxKind.PercentToken) {
    return isUnsignedInteger(type) ? 'urem' : 'srem'
  }

  return undefined
}

/**
 * Determines whether the operator is a division or a remainder.
 */
function isDivisionOperator(operator: ts.SyntaxKind): boolean {
  return operator === ts.SyntaxKind.SlashToken || operator === ts.SyntaxKind.PercentToken
}

/**
 * Returns the comparison opcode of an operator for the given type.
 */
function comparisonOpcodeOf(operator: ts.SyntaxKind, type: Type): string | undefined {
  if (isFloatType(type)) {
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

  const unsigned = isUnsignedInteger(type)

  if (
    operator === ts.SyntaxKind.EqualsEqualsToken ||
    operator === ts.SyntaxKind.EqualsEqualsEqualsToken
  ) {
    return 'icmp eq'
  }

  if (
    operator === ts.SyntaxKind.ExclamationEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsEqualsToken
  ) {
    return 'icmp ne'
  }

  if (operator === ts.SyntaxKind.LessThanToken) {
    return unsigned ? 'icmp ult' : 'icmp slt'
  }

  if (operator === ts.SyntaxKind.LessThanEqualsToken) {
    return unsigned ? 'icmp ule' : 'icmp sle'
  }

  if (operator === ts.SyntaxKind.GreaterThanToken) {
    return unsigned ? 'icmp ugt' : 'icmp sgt'
  }

  if (operator === ts.SyntaxKind.GreaterThanEqualsToken) {
    return unsigned ? 'icmp uge' : 'icmp sge'
  }

  return undefined
}

/**
 * Returns the signed comparison opcode of an operator, for string comparisons.
 */
function signedComparisonOpcodeOf(operator: ts.SyntaxKind): string | undefined {
  if (
    operator === ts.SyntaxKind.EqualsEqualsToken ||
    operator === ts.SyntaxKind.EqualsEqualsEqualsToken
  ) {
    return 'icmp eq'
  }

  if (
    operator === ts.SyntaxKind.ExclamationEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsEqualsToken
  ) {
    return 'icmp ne'
  }

  if (operator === ts.SyntaxKind.LessThanToken) {
    return 'icmp slt'
  }

  if (operator === ts.SyntaxKind.LessThanEqualsToken) {
    return 'icmp sle'
  }

  if (operator === ts.SyntaxKind.GreaterThanToken) {
    return 'icmp sgt'
  }

  if (operator === ts.SyntaxKind.GreaterThanEqualsToken) {
    return 'icmp sge'
  }

  return undefined
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
 * Determines whether the operator is an assignment.
 */
function isAssignmentOperator(operator: ts.SyntaxKind): boolean {
  return (
    operator === ts.SyntaxKind.EqualsToken ||
    operator === ts.SyntaxKind.PlusEqualsToken ||
    operator === ts.SyntaxKind.MinusEqualsToken ||
    operator === ts.SyntaxKind.AsteriskEqualsToken ||
    operator === ts.SyntaxKind.SlashEqualsToken ||
    operator === ts.SyntaxKind.PercentEqualsToken
  )
}

/**
 * Returns the arithmetic operator of a compound assignment.
 */
function compoundOperatorOf(operator: ts.SyntaxKind): ts.SyntaxKind | undefined {
  if (operator === ts.SyntaxKind.PlusEqualsToken) {
    return ts.SyntaxKind.PlusToken
  }

  if (operator === ts.SyntaxKind.MinusEqualsToken) {
    return ts.SyntaxKind.MinusToken
  }

  if (operator === ts.SyntaxKind.AsteriskEqualsToken) {
    return ts.SyntaxKind.AsteriskToken
  }

  if (operator === ts.SyntaxKind.SlashEqualsToken) {
    return ts.SyntaxKind.SlashToken
  }

  if (operator === ts.SyntaxKind.PercentEqualsToken) {
    return ts.SyntaxKind.PercentToken
  }

  return undefined
}

/**
 * Returns the printf format of the print builtin for a type.
 */
function printFormatOf(type: Type): { text: string } {
  if (type.kind === 'primitive') {
    if (type.name === 'i8' || type.name === 'i16' || type.name === 'i32') {
      return { text: '%d\n' }
    }

    if (type.name === 'i64' || type.name === 'u64' || type.name === 'usize') {
      return { text: '%lld\n' }
    }

    if (type.name === 'u8' || type.name === 'u16' || type.name === 'u32') {
      return { text: '%u\n' }
    }

    if (type.name === 'f32' || type.name === 'f64') {
      return { text: '%f\n' }
    }

    if (type.name === 'boolean' || type.name === 'string') {
      return { text: '%s\n' }
    }
  }

  throw new Error(`The print builtin does not accept ${describeType(type)} values.`)
}

/**
 * Determines whether a builtin parameter accepts values of the given type.
 */
function builtinAccepts(parameter: Type, type: Type): boolean {
  const members = parameter.kind === 'union' ? parameter.types : [parameter]

  return members.some((member) => sameType(member, type))
}

/**
 * Reads the visibility of a class member.
 */
function visibilityOf(member: ts.ClassElement): MemberVisibility {
  const modifiers = ts.canHaveModifiers(member) ? member.modifiers : undefined

  if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword)) {
    return 'private'
  }

  if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ProtectedKeyword)) {
    return 'protected'
  }

  return 'public'
}

/**
 * Reads the name of a class member.
 */
function memberNameOf(name: ts.MemberName | ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }

  throw new CompilerError('unsupported', 'Class members require a simple name.', name)
}

/**
 * Reads the name of a function declaration, rejecting reserved names.
 */
function functionNameOf(declaration: ts.FunctionDeclaration, reserved: string): string {
  if (declaration.name === undefined || !ts.isIdentifier(declaration.name)) {
    throw new CompilerError('unsupported', 'Functions require a simple name.', declaration)
  }

  const name = declaration.name.text

  if (name === reserved || name.includes('.')) {
    throw new CompilerError('reserved-name', `Function name '${name}' is reserved.`, declaration)
  }

  return name
}

/**
 * Reads the name of a parameter.
 */
function parameterNameOf(parameter: ts.ParameterDeclaration): string {
  if (!ts.isIdentifier(parameter.name)) {
    throw new CompilerError('unsupported', 'Parameters require a simple name.', parameter)
  }

  return parameter.name.text
}

/**
 * Reads the base class name of a class declaration.
 */
function baseNameOf(statement: ts.ClassDeclaration): string | undefined {
  const clause = statement.heritageClauses?.find(
    (heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword,
  )
  const base = clause?.types[0]

  if (base === undefined) {
    return undefined
  }

  if (!ts.isIdentifier(base.expression)) {
    throw new CompilerError('unsupported', 'Base classes require a simple name.', statement)
  }

  return base.expression.text
}

/**
 * Builds the signature of a method, with the instance as the first parameter.
 */
function methodSignatureOf(
  member: ts.MethodDeclaration,
  className: string,
  methodName: string,
): FunctionSignature {
  if (member.type === undefined) {
    throw new CompilerError(
      'missing-annotation',
      `Method '${methodName}' of class '${className}' requires a return type annotation.`,
      member,
    )
  }

  return {
    name: `${className}.${methodName}`,
    parameterTypes: [
      { kind: 'reference', name: className, typeArguments: [] },
      ...member.parameters.map((parameter) => {
        if (parameter.dotDotDotToken !== undefined) {
          throw new CompilerError(
            'unsupported',
            `Rest parameters are not supported yet in method '${methodName}'.`,
            parameter,
          )
        }

        if (parameter.questionToken !== undefined) {
          throw new CompilerError(
            'unsupported',
            `Optional parameters are not supported yet in method '${methodName}'.`,
            parameter,
          )
        }

        if (parameter.type === undefined) {
          throw new CompilerError(
            'missing-annotation',
            `Parameter '${parameterNameOf(parameter)}' of method '${methodName}' requires a type annotation.`,
            parameter,
          )
        }

        return typeFromNode(parameter.type)
      }),
    ],
    returnType: typeFromNode(member.type),
  }
}

/**
 * Builds the signature of a constructor, with the instance as the first parameter.
 */
function constructorSignatureOf(
  member: ts.ConstructorDeclaration,
  className: string,
): FunctionSignature {
  return {
    name: `${className}.constructor`,
    parameterTypes: [
      { kind: 'reference', name: className, typeArguments: [] },
      ...member.parameters.map((parameter) => {
        if (parameter.dotDotDotToken !== undefined) {
          throw new CompilerError(
            'unsupported',
            `Rest parameters are not supported yet in the constructor of '${className}'.`,
            member,
          )
        }

        if (parameter.questionToken !== undefined) {
          throw new CompilerError(
            'unsupported',
            `Optional parameters are not supported yet in the constructor of '${className}'.`,
            member,
          )
        }

        if (parameter.type === undefined) {
          throw new CompilerError(
            'missing-annotation',
            `Parameter '${parameterNameOf(parameter)}' of the constructor of '${className}' requires a type annotation.`,
            member,
          )
        }

        return typeFromNode(parameter.type)
      }),
    ],
    returnType: voidType,
  }
}

/**
 * Finds the declaration of a method in a class or any of its base classes.
 */
function findMethodDeclaration(
  context: GenerationContext,
  className: string,
  methodName: string,
): ts.MethodDeclaration | ts.ConstructorDeclaration | undefined {
  let current: string | undefined = className

  while (current !== undefined) {
    const declaration = context.sourceClasses.get(current)

    if (declaration !== undefined) {
      for (const member of declaration.members) {
        if (ts.isMethodDeclaration(member) && memberNameOf(member.name) === methodName) {
          return member
        }

        if (methodName === 'constructor' && ts.isConstructorDeclaration(member)) {
          return member
        }
      }
    }

    current = context.classes.get(current)?.base
  }

  return undefined
}

/**
 * Renders the name of the vtable global of a class.
 */
function vtableText(info: ClassInfo): string {
  return `@${info.name}.vt`
}
