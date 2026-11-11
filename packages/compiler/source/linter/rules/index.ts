import { noDebugger } from './no-debugger.js'
import { noDoubleEquals } from './no-double-equals.js'
import { noEmptyBlock } from './no-empty-block.js'
import { noEval } from './no-eval.js'
import { noNestedTernary } from './no-nested-ternary.js'
import type { Rule } from './rule.js'

export * from './no-debugger.js'
export * from './no-double-equals.js'
export * from './no-empty-block.js'
export * from './no-eval.js'
export * from './no-nested-ternary.js'
export type * from './rule.js'

/** Rules that run when the analyzer is created without explicit rules. */
export const defaultRules: readonly Rule[] = [
  noDebugger,
  noDoubleEquals,
  noEmptyBlock,
  noEval,
  noNestedTernary,
]
