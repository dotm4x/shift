/** Kind of a Livescript type. */
export type TypeKind =
  | 'array'
  | 'boolean'
  | 'conditional'
  | 'enum'
  | 'function'
  | 'intersection'
  | 'literal'
  | 'mapped'
  | 'never'
  | 'null'
  | 'object'
  | 'primitive'
  | 'reference'
  | 'templateLiteral'
  | 'tuple'
  | 'undefined'
  | 'union'
  | 'uniqueSymbol'
  | 'unknown'
  | 'void'

/** Name of a primitive type. */
export type PrimitiveName =
  | 'boolean'
  | 'f32'
  | 'f64'
  | 'i16'
  | 'i32'
  | 'i64'
  | 'i8'
  | 'null'
  | 'string'
  | 'u16'
  | 'u32'
  | 'u64'
  | 'u8'
  | 'undefined'
  | 'usize'

/** A primitive type, such as `i32` or `f64`. */
export interface PrimitiveType {
  readonly kind: 'primitive'
  readonly name: PrimitiveName
}

/** A type that holds a single literal value, such as `"hi"` or `42`. */
export interface LiteralType {
  readonly kind: 'literal'
  readonly primitive: 'boolean' | 'f64' | 'i32' | 'i64' | 'string'
  readonly value: string | number | boolean
}

/** An array type. */
export interface ArrayType {
  readonly kind: 'array'
  readonly elementType: Type
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

/** A tuple type with a fixed list of element types. */
export interface TupleType {
  readonly kind: 'tuple'
  readonly elementTypes: readonly Type[]
}

/** The `boolean` primitive type. */
export const booleanType: PrimitiveType = { kind: 'primitive', name: 'boolean' }

/** The `string` primitive type. */
export const stringType: PrimitiveType = { kind: 'primitive', name: 'string' }

/** The `null` primitive type. */
export const nullType: PrimitiveType = { kind: 'primitive', name: 'null' }

/** The `undefined` primitive type. */
export const undefinedType: PrimitiveType = { kind: 'primitive', name: 'undefined' }

/** The `f32` type. */
export const f32Type: PrimitiveType = { kind: 'primitive', name: 'f32' }

/** The `f64` type. */
export const f64Type: PrimitiveType = { kind: 'primitive', name: 'f64' }

/** The `i16` type. */
export const i16Type: PrimitiveType = { kind: 'primitive', name: 'i16' }

/** The `i32` type. */
export const i32Type: PrimitiveType = { kind: 'primitive', name: 'i32' }

/** The `i64` type. */
export const i64Type: PrimitiveType = { kind: 'primitive', name: 'i64' }

/** The `i8` type. */
export const i8Type: PrimitiveType = { kind: 'primitive', name: 'i8' }

/** The `u16` type. */
export const u16Type: PrimitiveType = { kind: 'primitive', name: 'u16' }

/** The `u32` type. */
export const u32Type: PrimitiveType = { kind: 'primitive', name: 'u32' }

/** The `u64` type. */
export const u64Type: PrimitiveType = { kind: 'primitive', name: 'u64' }

/** The `u8` type. */
export const u8Type: PrimitiveType = { kind: 'primitive', name: 'u8' }

/** The `usize` type. */
export const usizeType: PrimitiveType = { kind: 'primitive', name: 'usize' }

/** The `never` type. */
export const neverType: NeverType = { kind: 'never' }

/** The `unknown` type. */
export const unknownType: UnknownType = { kind: 'unknown' }

/** The `void` type. */
export const voidType: VoidType = { kind: 'void' }

/** The `unique symbol` type. */
export const uniqueSymbolType: UniqueSymbolType = { kind: 'uniqueSymbol' }

/** Names of the numeric types recognized by the language. */
export const numericTypeNames: ReadonlySet<string> = new Set<string>([
  'f32',
  'f64',
  'i16',
  'i32',
  'i64',
  'i8',
  'u16',
  'u32',
  'u64',
  'u8',
  'usize',
])

/** Names of every type recognized without a declaration. */
export const builtinTypeNames: ReadonlySet<string> = new Set<string>([
  ...numericTypeNames,
  'boolean',
  'string',
])
