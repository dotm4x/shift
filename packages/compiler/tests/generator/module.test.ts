import { describe, expect, it } from 'vitest'

import { voidType } from '../../source/analyzer/types/type.js'
import { LlvmModule } from '../../source/generator/module.js'

describe('LlvmModule', () => {
  it('interns equal string literals', () => {
    const module = new LlvmModule()
    const first = module.addStringLiteral('hi')
    const second = module.addStringLiteral('hi')

    expect(second).toBe(first)
    expect(module.addStringLiteral('ho')).not.toBe(first)
  })

  it('returns the byte length of string globals', () => {
    const module = new LlvmModule()
    const global = module.addStringLiteral('hi')

    expect(module.stringLength(global)).toBe(3)
    expect(() => module.stringLength({ kind: 'global', name: '.str.9' })).toThrow(
      'Unknown string global',
    )
  })

  it('emits globals before functions', () => {
    const module = new LlvmModule()
    module.addStringLiteral('hi')
    module
      .addFunction({ name: 'sample', parameterTypes: [], returnType: voidType }, [])
      .returnVoid()

    expect(module.emit()).toBe(
      [
        '@.str.0 = private unnamed_addr constant [3 x i8] c"hi\\00"',
        '',
        'define void @sample() {',
        'entry:',
        '  ret void',
        '}',
        '',
      ].join('\n'),
    )
  })
})
