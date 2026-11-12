import {
  booleanType,
  f32Type,
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
  u64Type,
  usizeType,
  voidType,
} from '../analyzer/types/type.js'

/** A function provided by the language itself. */
export interface Builtin {
  /** Name used to call the builtin from source code. */
  readonly name: string
  /** Accepted parameter types; each parameter accepts the union of its types. */
  readonly parameters: readonly Type[]
  /** Type the builtin returns. */
  readonly returnType: Type
}

/** Every numeric type accepted by the `print` builtin. */
const numericPrintTypes: readonly Type[] = [
  booleanType,
  f32Type,
  f64Type,
  i16Type,
  i32Type,
  i64Type,
  i8Type,
  stringType,
  u16Type,
  u32Type,
  u64Type,
  u8Type,
  usizeType,
]

/** The `print` builtin writes a value to the standard output. */
export const printBuiltin: Builtin = {
  name: 'print',
  parameters: [{ kind: 'union', types: numericPrintTypes }],
  returnType: voidType,
}

/** Builtins available in every program. */
export const defaultBuiltins: readonly Builtin[] = [printBuiltin]
