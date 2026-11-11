import * as ts from 'typescript'

import type { Rule } from './rule.js'

/** Reports conditional expressions nested inside other conditional expressions. */
export const noNestedTernary: Rule = {
  code: 'no-nested-ternary',
  create(context) {
    return {
      [ts.SyntaxKind.ConditionalExpression]: (node) => {
        if (!ts.isConditionalExpression(node)) {
          return
        }

        if (
          ts.isConditionalExpression(node.whenTrue) ||
          ts.isConditionalExpression(node.whenFalse)
        ) {
          context.report(node, 'Avoid nesting conditional expressions.')
        }
      },
    }
  },
}
