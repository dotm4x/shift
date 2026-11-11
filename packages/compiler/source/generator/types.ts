import type * as ts from 'typescript'

import { typeFromNode } from '../analyzer/types/syntax.js'
import type { Type } from '../analyzer/types/type.js'

import type { LlvmType } from './values.js'

/** Kind of a value while it is being generated. */
export type ValueKind = 'boolean' | 'number' | 'string' | 'void'

/**
 * Maps a language type to its LLVM IR type.
 *
 * @param type Type from the language model.
 * @returns Equivalent LLVM IR type.
 * @throws When the type has no representation in the generated code yet.
 */
export function irTypeFromType(type: Type): LlvmType {
  if (type.kind === 'primitive') {
    if (type.name === 'boolean') {
      return 'i1'
    }

    if (type.name === 'number') {
      return 'double'
    }

    if (type.name === 'string') {
      return 'ptr'
    }
  }

  if (type.kind === 'void') {
    return 'void'
  }

  throw new Error(`Unsupported type for code generation: ${describe(type)}.`)
}

/**
 * Maps a type node from the syntax tree to its LLVM IR type.
 *
 * @param node Type node from the syntax tree.
 * @returns Equivalent LLVM IR type.
 */
export function irTypeFromNode(node: ts.TypeNode): LlvmType {
  return irTypeFromType(typeFromNode(node))
}

/**
 * Maps a value kind to its LLVM IR type.
 *
 * @param kind Kind of the value.
 * @returns Equivalent LLVM IR type.
 */
export function irTypeFromKind(kind: ValueKind): LlvmType {
  if (kind === 'boolean') {
    return 'i1'
  }

  if (kind === 'number') {
    return 'double'
  }

  if (kind === 'string') {
    return 'ptr'
  }

  return 'void'
}

/**
 * Maps an LLVM IR type back to its value kind.
 *
 * @param type LLVM IR type.
 * @returns Equivalent value kind.
 */
export function irKindFromType(type: LlvmType): ValueKind {
  if (type === 'double') {
    return 'number'
  }

  if (type === 'i1') {
    return 'boolean'
  }

  if (type === 'ptr') {
    return 'string'
  }

  return 'void'
}

/**
 * Describes a type for error messages.
 */
function describe(type: Type): string {
  return type.kind === 'primitive' ? type.name : type.kind
}
