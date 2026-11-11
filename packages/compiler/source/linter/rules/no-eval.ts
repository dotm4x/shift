import * as ts from 'typescript'

import type { Rule } from './rule.js'

/** Reports calls to `eval`. */
export const noEval: Rule = {
  code: 'no-eval',
  create(context) {
    return {
      [ts.SyntaxKind.CallExpression]: (node) => {
        if (!ts.isCallExpression(node)) {
          return
        }

        if (ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
          context.report(node, 'Unexpected `eval` call.')
        }
      },
    }
  },
}
