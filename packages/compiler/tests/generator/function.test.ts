import { describe, expect, it } from 'vitest'

import { LlvmFunction } from '../../source/generator/function.js'

function create(): LlvmFunction {
  return new LlvmFunction({ name: 'sample', parameterTypes: ['double'], returnType: 'double' }, [
    'value',
  ])
}

describe('LlvmFunction', () => {
  it('renders its signature and parameters', () => {
    expect(create().emit()).toBe(
      ['define double @sample(double %value) {', 'entry:', '}'].join('\n'),
    )
  })

  it('hoists allocas into the entry block', () => {
    const added = new LlvmFunction({ name: 'sample', parameterTypes: [], returnType: 'void' }, [])
    added.alloca('double', 'value')
    added.returnVoid()
    added.startBlock(added.reserveLabel('next'))
    added.alloca('i1', 'flag')
    added.returnVoid()

    expect(added.emit()).toBe(
      [
        'define void @sample() {',
        'entry:',
        '  %value.addr = alloca double',
        '  %flag.addr = alloca i1',
        '  ret void',
        'next:',
        '  ret void',
        '}',
      ].join('\n'),
    )
  })

  it('uniquifies names', () => {
    const added = create()
    const first = added.alloca('double', 'value')
    const second = added.alloca('double', 'value')

    expect(first.name).toBe('value.addr')
    expect(second.name).toBe('value.addr.1')
    expect(added.reserveLabel('loop')).toBe('loop')
    expect(added.reserveLabel('loop')).toBe('loop.1')
  })

  it('emits instructions in the current block', () => {
    const added = create()
    const pointer = added.alloca('double', 'value')
    const loaded = added.load('double', pointer)
    added.store('double', loaded, pointer)
    const summed = added.binary('double', 'fadd', loaded, {
      kind: 'constant',
      type: 'double',
      text: '1.0',
    })
    added.returnValue('double', summed)

    expect(added.emit()).toBe(
      [
        'define double @sample(double %value) {',
        'entry:',
        '  %value.addr = alloca double',
        '  %t0 = load double, ptr %value.addr',
        '  store double %t0, ptr %value.addr',
        '  %t1 = fadd double %t0, 1.0',
        '  ret double %t1',
        '}',
      ].join('\n'),
    )
  })

  it('rejects instructions after a terminator', () => {
    const added = create()
    added.returnVoid()

    expect(() => added.load('double', { kind: 'local', name: 'value.addr' })).toThrow(
      'already terminated',
    )
  })

  it('rejects unterminated blocks', () => {
    const added = create()

    expect(() => {
      added.startBlock('next')
    }).toThrow('not terminated')
  })

  it('renders calls and branches', () => {
    const added = new LlvmFunction({ name: 'sample', parameterTypes: [], returnType: 'void' }, [])
    const thenLabel = added.reserveLabel('if.then')
    const endLabel = added.reserveLabel('if.end')
    added.branch({ kind: 'constant', type: 'i1', text: '1' }, thenLabel, endLabel)
    added.startBlock(thenLabel)
    added.call('void', 'helper', [])
    added.jump(endLabel)
    added.startBlock(endLabel)
    added.returnVoid()

    expect(added.emit()).toBe(
      [
        'define void @sample() {',
        'entry:',
        '  br i1 1, label %if.then, label %if.end',
        'if.then:',
        '  call void @helper()',
        '  br label %if.end',
        'if.end:',
        '  ret void',
        '}',
      ].join('\n'),
    )
  })
})
