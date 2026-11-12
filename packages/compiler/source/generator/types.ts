import type * as ts from 'typescript'

import { typeFromNode } from '../analyzer/types/syntax.js'
import type { ArrayType, ReferenceType, Type, VoidType } from '../analyzer/types/type.js'

import type { LlvmType } from './values.js'

/**
 * Maps a language type to its LLVM IR type.
 *
 * @param type Type from the language model.
 * @returns Equivalent LLVM IR type.
 * @throws When the type has no representation in the generated code yet.
 */
export function irTypeFromType(type: Type): LlvmType {
  if (type.kind === 'primitive') {
    const numeric: Partial<{ [key: string]: LlvmType }> = {
      boolean: 'i1',
      f32: 'float',
      f64: 'double',
      i16: 'i16',
      i32: 'i32',
      i64: 'i64',
      i8: 'i8',
      string: 'ptr',
      u16: 'i16',
      u32: 'i32',
      u64: 'i64',
      u8: 'i8',
      usize: 'i64',
    }
    const mapped = numeric[type.name]

    if (mapped !== undefined) {
      return mapped
    }
  }

  if (
    type.kind === 'array' ||
    type.kind === 'object' ||
    type.kind === 'reference' ||
    type.kind === 'unknown'
  ) {
    return 'ptr'
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
 * Returns the byte size of a type in the generated code.
 *
 * @param type Type from the language model.
 * @returns Size in bytes.
 */
export function sizeOf(type: Type): number {
  if (type.kind === 'primitive') {
    const sizes: Partial<{ [key: string]: number }> = {
      boolean: 1,
      f32: 4,
      f64: 8,
      i16: 2,
      i32: 4,
      i64: 8,
      i8: 1,
      string: 8,
      u16: 2,
      u32: 4,
      u64: 8,
      u8: 1,
      usize: 8,
    }
    const size = sizes[type.name]

    if (size !== undefined) {
      return size
    }
  }

  if (
    type.kind === 'array' ||
    type.kind === 'object' ||
    type.kind === 'reference' ||
    type.kind === 'unknown'
  ) {
    return 8
  }

  throw new Error(`Unsupported type for code generation: ${describe(type)}.`)
}

/** Determines whether the type is a signed integer. */
export function isSignedInteger(type: Type): boolean {
  return (
    type.kind === 'primitive' &&
    (type.name === 'i8' || type.name === 'i16' || type.name === 'i32' || type.name === 'i64')
  )
}

/** Determines whether the type is an unsigned integer. */
export function isUnsignedInteger(type: Type): boolean {
  return (
    type.kind === 'primitive' &&
    (type.name === 'u8' ||
      type.name === 'u16' ||
      type.name === 'u32' ||
      type.name === 'u64' ||
      type.name === 'usize')
  )
}

/** Determines whether the type is an integer of any signedness. */
export function isIntegerType(type: Type): boolean {
  return isSignedInteger(type) || isUnsignedInteger(type)
}

/** Determines whether the type is a floating point number. */
export function isFloatType(type: Type): boolean {
  return type.kind === 'primitive' && (type.name === 'f32' || type.name === 'f64')
}

/** Determines whether the type is any number. */
export function isNumericType(type: Type): boolean {
  return isIntegerType(type) || isFloatType(type)
}

/** Determines whether the type is void. */
export function isVoidType(type: Type): type is VoidType {
  return type.kind === 'void'
}

/** Determines whether the type is a boolean. */
export function isBooleanType(type: Type): boolean {
  return type.kind === 'primitive' && type.name === 'boolean'
}

/** Determines whether the type is null. */
export function isNullType(type: Type): boolean {
  return type.kind === 'primitive' && type.name === 'null'
}

/** Determines whether the type is a string. */
export function isStringType(type: Type): boolean {
  return type.kind === 'primitive' && type.name === 'string'
}

/** Determines whether the type is an array. */
export function isArrayType(type: Type): type is ArrayType {
  return type.kind === 'array'
}

/** Determines whether the type refers to a class instance. */
export function isReferenceType(type: Type): type is ReferenceType {
  return type.kind === 'reference'
}

/**
 * Describes a type for error messages.
 */
function describe(type: Type): string {
  return type.kind === 'primitive' ? type.name : type.kind
}
