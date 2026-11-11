/** Kind of a Livescript type. */
export type TypeKind =
  | 'array'
  | 'conditional'
  | 'enum'
  | 'function'
  | 'intersection'
  | 'literal'
  | 'mapped'
  | 'never'
  | 'object'
  | 'primitive'
  | 'reference'
  | 'templateLiteral'
  | 'tuple'
  | 'union'
  | 'uniqueSymbol'
  | 'unknown'
  | 'void'

/** Name of a primitive type. */
export type PrimitiveName =
  'bigint' | 'boolean' | 'null' | 'number' | 'object' | 'string' | 'undefined'

/** A primitive type, such as `number` or `string`. */
export interface PrimitiveType {
  readonly kind: 'primitive'
  readonly name: PrimitiveName
}

/** A type that holds a single literal value, such as `"hi"` or `42`. */
export interface LiteralType {
  readonly kind: 'literal'
  readonly primitive: 'boolean' | 'number' | 'string'
  readonly value: string | number | boolean
}

/** An array type. */
export interface ArrayType {
  readonly kind: 'array'
  readonly elementType: Type
}

/** A tuple type with a fixed list of element types. */
export interface TupleType {
  readonly kind: 'tuple'
  readonly elementTypes: readonly Type[]
}

/** A property of an object type. */
export interface TypeProperty {
  readonly name: string
  readonly type: Type
  readonly optional: boolean
}

/** A structural object type. */
export interface ObjectType {
  readonly kind: 'object'
  readonly properties: readonly TypeProperty[]
}

/** A parameter of a function type. */
export interface FunctionParameter {
  readonly name: string
  readonly type: Type
  readonly optional: boolean
}

/** A generic parameter declared by a function type, such as `T extends number`. */
export interface GenericParameter {
  readonly name: string
  readonly constraint: Type | undefined
  readonly defaultType: Type | undefined
}

/** A function type. */
export interface FunctionType {
  readonly kind: 'function'
  readonly parameters: readonly FunctionParameter[]
  readonly returnType: Type
  readonly typeParameters?: readonly GenericParameter[]
}

/** A union of types. */
export interface UnionType {
  readonly kind: 'union'
  readonly types: readonly Type[]
}

/** An intersection of types. */
export interface IntersectionType {
  readonly kind: 'intersection'
  readonly types: readonly Type[]
}

/** A reference to a named type, such as an alias, an interface or a class. */
export interface ReferenceType {
  readonly kind: 'reference'
  readonly name: string
  readonly typeArguments: readonly Type[]
}

/** The type of a declared enum. */
export interface EnumType {
  readonly kind: 'enum'
  readonly name: string
}

/** The type of a `unique symbol` value. */
export interface UniqueSymbolType {
  readonly kind: 'uniqueSymbol'
}

/**
 * A template literal type, such as `` `hi ${string}` ``. String parts alternate with the types of
 * the placeholders.
 */
export interface TemplateLiteralType {
  readonly kind: 'templateLiteral'
  readonly parts: readonly (string | Type)[]
}

/** A conditional type, such as `A extends B ? C : D`. */
export interface ConditionalType {
  readonly kind: 'conditional'
  readonly checkType: Type
  readonly extendsType: Type
  readonly trueType: Type
  readonly falseType: Type
}

/** A mapped type, such as `{ [K in string]: number }`. */
export interface MappedType {
  readonly kind: 'mapped'
  readonly parameter: string
  readonly constraint: Type
  readonly nameType: Type | undefined
  readonly template: Type
}

/** The top type; every value is assignable to it. */
export interface UnknownType {
  readonly kind: 'unknown'
}

/** The bottom type; no value inhabits it. */
export interface NeverType {
  readonly kind: 'never'
}

/** The type of a function that never returns. */
export interface VoidType {
  readonly kind: 'void'
}

/** Any Livescript type. */
export type Type =
  | ArrayType
  | ConditionalType
  | EnumType
  | FunctionType
  | IntersectionType
  | LiteralType
  | MappedType
  | NeverType
  | ObjectType
  | PrimitiveType
  | ReferenceType
  | TemplateLiteralType
  | TupleType
  | UnionType
  | UniqueSymbolType
  | UnknownType
  | VoidType

/** The `bigint` primitive type. */
export const bigintType: PrimitiveType = { kind: 'primitive', name: 'bigint' }

/** The `boolean` primitive type. */
export const booleanType: PrimitiveType = { kind: 'primitive', name: 'boolean' }

/** The `null` primitive type. */
export const nullType: PrimitiveType = { kind: 'primitive', name: 'null' }

/** The `number` primitive type. */
export const numberType: PrimitiveType = { kind: 'primitive', name: 'number' }

/** The `object` type; every non-primitive value is assignable to it. */
export const objectType: PrimitiveType = { kind: 'primitive', name: 'object' }

/** The `string` primitive type. */
export const stringType: PrimitiveType = { kind: 'primitive', name: 'string' }

/** The `undefined` primitive type. */
export const undefinedType: PrimitiveType = { kind: 'primitive', name: 'undefined' }

/** The `never` type. */
export const neverType: NeverType = { kind: 'never' }

/** The `unknown` type. */
export const unknownType: UnknownType = { kind: 'unknown' }

/** The `void` type. */
export const voidType: VoidType = { kind: 'void' }

/** The `unique symbol` type. */
export const uniqueSymbolType: UniqueSymbolType = { kind: 'uniqueSymbol' }
