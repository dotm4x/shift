import type { Type } from '../analyzer/types/type.js'

import { irTypeFromType } from './types.js'
import type { LlvmGlobal, LlvmLocal, LlvmOperand, LlvmType } from './values.js'

/** Signature of a function in the module. */
export interface FunctionSignature {
  readonly name: string
  readonly parameterTypes: readonly Type[]
  readonly returnType: Type
}

/** An argument passed to a call. */
export interface CallArgument {
  readonly type: LlvmType
  readonly value: LlvmOperand
}

interface Block {
  label: string
  lines: string[]
  terminated: boolean
}

/**
 * Maps a language type to its LLVM IR type.
 */
function irTypeOf(type: Type): LlvmType {
  return irTypeFromType(type)
}

/**
 * Builds the body of a single LLVM IR function.
 */
export class LlvmFunction {
  private readonly _signature: FunctionSignature
  private readonly _parameterNames: readonly string[]
  private readonly _allocas: string[] = []
  private readonly _blocks: Block[] = []
  private readonly _usedNames: Set<string> = new Set<string>()
  private _temporaryCounter: number = 0

  /**
   * @param signature Signature of the function.
   * @param parameterNames Names of the parameters, in the same order as the signature types.
   */
  public constructor(signature: FunctionSignature, parameterNames: readonly string[]) {
    this._signature = signature
    this._parameterNames = parameterNames
    this.startBlock('entry')
  }

  /** Signature of the function being built. */
  public get signature(): FunctionSignature {
    return this._signature
  }

  /** Whether the current block already ends with a terminator. */
  public get terminated(): boolean {
    return this.currentBlock().terminated
  }

  /**
   * Reserves a unique block label based on a base name.
   *
   * @param base Base name of the label.
   * @returns Unique label.
   */
  public reserveLabel(base: string): string {
    return this.uniqueName(base)
  }

  /**
   * Starts a new block. The current block must already be terminated.
   *
   * @param label Label of the new block.
   */
  public startBlock(label: string): void {
    if (this._blocks.length > 0 && !this.terminated) {
      throw new Error(`Block '${this.currentBlock().label}' is not terminated.`)
    }

    this._usedNames.add(label)
    this._blocks.push({ label, lines: [], terminated: false })
  }

  /**
   * Reserves stack storage in the entry block, so allocas run exactly once.
   *
   * @param type Type of the stored value.
   * @param hint Name of the variable backed by the storage.
   * @returns Pointer to the storage.
   */
  public alloca(type: LlvmType, hint: string): LlvmLocal {
    const name = this.uniqueName(`${hint}.addr`)

    this._allocas.push(`%${name} = alloca ${type}`)

    return { kind: 'local', name }
  }

  /**
   * Reserves raw stack bytes in the entry block.
   *
   * @param bytes Number of bytes to reserve.
   * @param hint Name of the buffer.
   * @returns Pointer to the buffer.
   */
  public allocaBytes(bytes: number, hint: string): LlvmLocal {
    const name = this.uniqueName(`${hint}.addr`)

    this._allocas.push(`%${name} = alloca i8, i64 ${String(bytes)}`)

    return { kind: 'local', name }
  }

  /**
   * Loads a value from a pointer.
   *
   * @param type Type of the stored value.
   * @param pointer Pointer to load from.
   * @returns Loaded value.
   */
  public load(type: LlvmType, pointer: LlvmOperand): LlvmLocal {
    return this.emitValue(`load ${type}, ptr ${this.operand(pointer)}`)
  }

  /**
   * Stores a value into a pointer.
   *
   * @param type Type of the stored value.
   * @param value Value to store.
   * @param pointer Pointer to store into.
   */
  public store(type: LlvmType, value: LlvmOperand, pointer: LlvmOperand): void {
    this.add(`store ${type} ${this.operand(value)}, ptr ${this.operand(pointer)}`)
  }

  /**
   * Emits a binary instruction, such as `fadd`, `fcmp olt` or `xor`.
   *
   * @param type Type of the operands.
   * @param opcode Instruction opcode.
   * @param left Left operand.
   * @param right Right operand.
   * @returns Result of the instruction.
   */
  public binary(type: LlvmType, opcode: string, left: LlvmOperand, right: LlvmOperand): LlvmLocal {
    return this.emitValue(`${opcode} ${type} ${this.operand(left)}, ${this.operand(right)}`)
  }

  /**
   * Emits a unary instruction, such as `fneg`.
   *
   * @param type Type of the operand.
   * @param opcode Instruction opcode.
   * @param operand Operand.
   * @returns Result of the instruction.
   */
  public unary(type: LlvmType, opcode: string, operand: LlvmOperand): LlvmLocal {
    return this.emitValue(`${opcode} ${type} ${this.operand(operand)}`)
  }

  /**
   * Emits a call to a function of the module.
   *
   * @param returnType Return type of the callee.
   * @param name Name of the callee.
   * @param args Arguments of the call.
   * @returns Returned value, or `undefined` for void calls.
   */
  public call(
    returnType: LlvmType,
    name: string,
    args: readonly CallArgument[],
    calleeType?: string,
  ): LlvmLocal | undefined {
    const argumentsText = args
      .map((argument) => `${argument.type} ${this.operand(argument.value)}`)
      .join(', ')
    const callee = calleeType === undefined ? `@${name}` : `(${calleeType}) @${name}`
    const text = `call ${returnType} ${callee}(${argumentsText})`

    if (returnType === 'void') {
      this.add(text)

      return undefined
    }

    return this.emitValue(text)
  }

  /**
   * Emits a conversion instruction, such as `sext`, `trunc` or `sitofp`.
   *
   * @param opcode Conversion opcode.
   * @param sourceType Type of the operand.
   * @param operand Operand to convert.
   * @param targetType Type to convert to.
   * @returns Converted value.
   */
  public cast(
    opcode: string,
    sourceType: LlvmType,
    operand: LlvmOperand,
    targetType: LlvmType,
  ): LlvmLocal {
    return this.emitValue(`${opcode} ${sourceType} ${this.operand(operand)} to ${targetType}`)
  }

  /**
   * Selects between two values based on a boolean condition.
   *
   * @param type Type of the selected value.
   * @param condition Boolean condition.
   * @param ifTrue Value for the true case.
   * @param ifFalse Value for the false case.
   * @returns Selected value.
   */
  public select(
    type: LlvmType,
    condition: LlvmOperand,
    ifTrue: LlvmOperand,
    ifFalse: LlvmOperand,
  ): LlvmLocal {
    return this.emitValue(
      `select i1 ${this.operand(condition)}, ${type} ${this.operand(ifTrue)}, ${type} ${this.operand(ifFalse)}`,
    )
  }

  /**
   * Returns a pointer to the first byte of a string global.
   *
   * @param global Global of the string constant.
   * @param byteLength Byte length of the constant, including the terminator.
   * @returns Pointer to the string.
   */
  public stringPointer(global: LlvmGlobal, byteLength: number): LlvmLocal {
    return this.emitValue(
      `getelementptr inbounds [${String(byteLength)} x i8], ptr @${global.name}, i64 0, i64 0`,
    )
  }

  /**
   * Returns a pointer to a field of a structure.
   *
   * @param structureType Name of the LLVM structure type, such as `%Car`.
   * @param base Pointer to the structure.
   * @param index Field index.
   * @returns Pointer to the field.
   */
  public fieldPointer(structureType: string, base: LlvmOperand, index: number): LlvmLocal {
    return this.emitValue(
      `getelementptr inbounds ${structureType}, ptr ${this.operand(base)}, i64 0, i32 ${String(index)}`,
    )
  }

  /**
   * Returns a pointer to an element of an array of the given element type.
   *
   * @param elementType Name of the LLVM element type, such as `ptr`.
   * @param base Pointer to the array.
   * @param index i64 index of the element.
   * @returns Pointer to the element.
   */
  public elementPointer(elementType: string, base: LlvmOperand, index: LlvmOperand): LlvmLocal {
    return this.emitValue(
      `getelementptr inbounds ${elementType}, ptr ${this.operand(base)}, i64 ${this.operand(index)}`,
    )
  }

  /**
   * Returns a pointer to a byte at a byte offset from a base pointer.
   *
   * @param base Base pointer.
   * @param byteOffset Byte offset, as an i64 operand.
   * @returns Pointer to the byte.
   */
  public bytePointer(base: LlvmOperand, byteOffset: LlvmOperand): LlvmLocal {
    return this.emitValue(
      `getelementptr inbounds i8, ptr ${this.operand(base)}, i64 ${this.operand(byteOffset)}`,
    )
  }

  /**
   * Calls a function through a function pointer.
   *
   * @param returnType Return type of the callee.
   * @param functionPointer Pointer to the function.
   * @param args Arguments of the call.
   * @returns Returned value, or `undefined` for void calls.
   */
  public callValue(
    returnType: LlvmType,
    functionPointer: LlvmOperand,
    args: readonly CallArgument[],
  ): LlvmLocal | undefined {
    const argumentsText = args
      .map((argument) => `${argument.type} ${this.operand(argument.value)}`)
      .join(', ')
    const text = `call ${returnType} ${this.operand(functionPointer)}(${argumentsText})`

    if (returnType === 'void') {
      this.add(text)

      return undefined
    }

    return this.emitValue(text)
  }

  /**
   * Branches to a label based on an integer switch value.
   *
   * @param value i32 operand to switch on.
   * @param defaultLabel Label for unmatched values.
   * @param cases Matched values and their labels.
   */
  public switchValue(
    value: LlvmOperand,
    defaultLabel: string,
    cases: readonly { label: string; value: number }[],
  ): void {
    const casesText = cases
      .map((entry) => `i32 ${String(entry.value)}, label %${entry.label}`)
      .join(' ')

    this.addTerminator(`switch i32 ${this.operand(value)}, label %${defaultLabel} [ ${casesText} ]`)
  }

  /**
   * Branches to a label based on a boolean test.
   *
   * @param test Boolean operand.
   * @param trueLabel Label for the true case.
   * @param falseLabel Label for the false case.
   */
  public branch(test: LlvmOperand, trueLabel: string, falseLabel: string): void {
    this.addTerminator(`br i1 ${this.operand(test)}, label %${trueLabel}, label %${falseLabel}`)
  }

  /**
   * Jumps to a label.
   *
   * @param label Label to jump to.
   */
  public jump(label: string): void {
    this.addTerminator(`br label %${label}`)
  }

  /**
   * Returns a value from the function.
   *
   * @param type Type of the returned value.
   * @param value Value to return.
   */
  public returnValue(type: LlvmType, value: LlvmOperand): void {
    this.addTerminator(`ret ${type} ${this.operand(value)}`)
  }

  /** Returns without a value from the function. */
  public returnVoid(): void {
    this.addTerminator('ret void')
  }

  /** Marks the rest of the function as unreachable. */
  public unreachable(): void {
    this.addTerminator('unreachable')
  }

  /**
   * Renders the function as LLVM IR text.
   *
   * @returns LLVM IR text of the function.
   */
  public emit(): string {
    const lines: string[] = [
      `define ${irTypeOf(this._signature.returnType)} @${this._signature.name}(${this.parametersText()}) {`,
    ]
    const entry = this._blocks[0]

    if (entry === undefined) {
      throw new Error('The function has no blocks.')
    }

    lines.push(`${entry.label}:`)
    lines.push(...this._allocas.map((line) => `  ${line}`))
    lines.push(...entry.lines.map((line) => `  ${line}`))

    for (const block of this._blocks.slice(1)) {
      lines.push(`${block.label}:`)
      lines.push(...block.lines.map((line) => `  ${line}`))
    }

    lines.push('}')

    return lines.join('\n')
  }

  /**
   * Renders the parameters of the function signature.
   */
  private parametersText(): string {
    return this._parameterNames
      .map((name, index) => {
        const type = this._signature.parameterTypes[index]

        if (type === undefined) {
          throw new Error(`Parameter '${name}' has no type.`)
        }

        return `${irTypeOf(type)} %${name}`
      })
      .join(', ')
  }

  /**
   * Adds an instruction to the current block.
   */
  private add(line: string): void {
    if (this.terminated) {
      throw new Error('The current block is already terminated.')
    }

    this.currentBlock().lines.push(line)
  }

  /**
   * Adds a terminator to the current block.
   */
  private addTerminator(line: string): void {
    if (this.terminated) {
      throw new Error('The current block is already terminated.')
    }

    this.add(line)
    this.currentBlock().terminated = true
  }

  /**
   * Adds an instruction that produces a value.
   */
  private emitValue(text: string): LlvmLocal {
    const local: LlvmLocal = { kind: 'local', name: `t${String(this._temporaryCounter)}` }
    this._temporaryCounter++

    this.add(`%${local.name} = ${text}`)

    return local
  }

  /**
   * Renders an operand for an instruction.
   */
  private operand(operand: LlvmOperand): string {
    if (operand.kind === 'local') {
      return `%${operand.name}`
    }

    if (operand.kind === 'global') {
      return `@${operand.name}`
    }

    return operand.text
  }

  /**
   * Returns a name based on the given one that is not used yet.
   */
  private uniqueName(base: string): string {
    let name = base
    let counter = 1

    while (this._usedNames.has(name)) {
      name = `${base}.${String(counter)}`
      counter++
    }

    this._usedNames.add(name)

    return name
  }

  /**
   * Returns the block being built.
   */
  private currentBlock(): Block {
    const block = this._blocks[this._blocks.length - 1]

    if (block === undefined) {
      throw new Error('No block is being built.')
    }

    return block
  }
}
