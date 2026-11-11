import * as ts from 'typescript'

import type { Rule } from './rule.js'

/**
 * Reports empty block statements. Empty function bodies are allowed. Requires a tree with parent
 * nodes linked, as produced by the parser.
 */
export const noEmptyBlock: Rule = {
  code: 'no-empty-block',
  create(context) {
    return {
      [ts.SyntaxKind.Block]: (node) => {
        if (!ts.isBlock(node)) {
          return
        }

        if (node.statements.length > 0) {
          return
        }

        if (ts.isFunctionLike(node.parent)) {
          return
        }

        context.report(node, 'Unexpected empty block.')
      },
    }
  },
}
