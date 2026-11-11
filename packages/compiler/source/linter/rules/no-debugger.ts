import * as ts from 'typescript'

import type { Rule } from './rule.js'

/** Reports `debugger` statements. */
export const noDebugger: Rule = {
  code: 'no-debugger',
  create(context) {
    return {
      [ts.SyntaxKind.DebuggerStatement]: (node) => {
        context.report(node, 'Unexpected debugger statement.')
      },
    }
  },
}
