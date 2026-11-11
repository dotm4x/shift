import * as ts from 'typescript'

import type { Rule } from './rule.js'

/** Reports loose equality and inequality comparisons. */
export const noDoubleEquals: Rule = {
  code: 'no-double-equals',
  create(context) {
    return {
      [ts.SyntaxKind.BinaryExpression]: (node) => {
        if (!ts.isBinaryExpression(node)) {
          return
        }

        if (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken) {
          context.report(node.operatorToken, 'Use `===` instead of `==`.')
        } else if (node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken) {
          context.report(node.operatorToken, 'Use `!==` instead of `!=`.')
        }
      },
    }
  },
}
