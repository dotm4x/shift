import { describe, expect, it } from 'vitest'

import { Generator } from '../../source/generator/generator.js'
import { Parser } from '../../source/parser/parser.js'
import { DiagnosticBag } from '../../source/shared/diagnostics/bag.js'

function generate(source: string, entryName?: string): string {
  const file = new Parser().parse(source, new DiagnosticBag())

  return new Generator().generate(file, entryName === undefined ? {} : { entryName })
}

describe('Generator', () => {
  it('generates arithmetic and variables', () => {
    const source = ['let a = 1', 'let b = 2.5', 'let total = a + b * 2'].join('\n')

    expect(generate(source)).toBe(
      [
        'define i32 @main() {',
        'entry:',
        '  %a.addr = alloca double',
        '  %b.addr = alloca double',
        '  %total.addr = alloca double',
        '  store double 1.0, ptr %a.addr',
        '  store double 2.5, ptr %b.addr',
        '  %t0 = load double, ptr %a.addr',
        '  %t1 = load double, ptr %b.addr',
        '  %t2 = fmul double %t1, 2.0',
        '  %t3 = fadd double %t0, %t2',
        '  store double %t3, ptr %total.addr',
        '  ret i32 0',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('generates functions with calls and recursion', () => {
    const source = [
      'function factorial(n: number): number {',
      '  if (n <= 1) {',
      '    return 1',
      '  }',
      '  return n * factorial(n - 1)',
      '}',
      '',
      'let result = factorial(5)',
    ].join('\n')

    expect(generate(source)).toBe(
      [
        'define double @factorial(double %n) {',
        'entry:',
        '  %n.addr = alloca double',
        '  store double %n, ptr %n.addr',
        '  %t0 = load double, ptr %n.addr',
        '  %t1 = fcmp ole double %t0, 1.0',
        '  br i1 %t1, label %if.then, label %if.end',
        'if.then:',
        '  ret double 1.0',
        'if.end:',
        '  %t2 = load double, ptr %n.addr',
        '  %t3 = load double, ptr %n.addr',
        '  %t4 = fsub double %t3, 1.0',
        '  %t5 = call double @factorial(double %t4)',
        '  %t6 = fmul double %t2, %t5',
        '  ret double %t6',
        '}',
        '',
        'define i32 @main() {',
        'entry:',
        '  %result.addr = alloca double',
        '  %t0 = call double @factorial(double 5.0)',
        '  store double %t0, ptr %result.addr',
        '  ret i32 0',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('generates while loops with break and continue', () => {
    const source = [
      'let i = 0',
      'let total = 0',
      'while (true) {',
      '  i = i + 1',
      '  if (i > 3) {',
      '    break',
      '  }',
      '  if (i == 2) {',
      '    continue',
      '  }',
      '  total = total + i',
      '}',
    ].join('\n')

    expect(generate(source)).toBe(
      [
        'define i32 @main() {',
        'entry:',
        '  %i.addr = alloca double',
        '  %total.addr = alloca double',
        '  store double 0.0, ptr %i.addr',
        '  store double 0.0, ptr %total.addr',
        '  br label %while.cond',
        'while.cond:',
        '  br i1 1, label %while.body, label %while.end',
        'while.body:',
        '  %t0 = load double, ptr %i.addr',
        '  %t1 = fadd double %t0, 1.0',
        '  store double %t1, ptr %i.addr',
        '  %t2 = load double, ptr %i.addr',
        '  %t3 = fcmp ogt double %t2, 3.0',
        '  br i1 %t3, label %if.then, label %if.end',
        'if.then:',
        '  br label %while.end',
        'if.end:',
        '  %t4 = load double, ptr %i.addr',
        '  %t5 = fcmp oeq double %t4, 2.0',
        '  br i1 %t5, label %if.then.1, label %if.end.1',
        'if.then.1:',
        '  br label %while.cond',
        'if.end.1:',
        '  %t6 = load double, ptr %total.addr',
        '  %t7 = load double, ptr %i.addr',
        '  %t8 = fadd double %t6, %t7',
        '  store double %t8, ptr %total.addr',
        '  br label %while.cond',
        'while.end:',
        '  ret i32 0',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('generates for loops', () => {
    const source = [
      'let total = 0',
      'for (let i = 0; i < 3; i++) {',
      '  total = total + i',
      '}',
    ].join('\n')

    expect(generate(source)).toBe(
      [
        'define i32 @main() {',
        'entry:',
        '  %total.addr = alloca double',
        '  %i.addr = alloca double',
        '  store double 0.0, ptr %total.addr',
        '  store double 0.0, ptr %i.addr',
        '  br label %for.cond',
        'for.cond:',
        '  %t0 = load double, ptr %i.addr',
        '  %t1 = fcmp olt double %t0, 3.0',
        '  br i1 %t1, label %for.body, label %for.end',
        'for.body:',
        '  %t2 = load double, ptr %total.addr',
        '  %t3 = load double, ptr %i.addr',
        '  %t4 = fadd double %t2, %t3',
        '  store double %t4, ptr %total.addr',
        '  br label %for.inc',
        'for.inc:',
        '  %t5 = load double, ptr %i.addr',
        '  %t6 = fadd double %t5, 1.0',
        '  store double %t6, ptr %i.addr',
        '  br label %for.cond',
        'for.end:',
        '  ret i32 0',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('interns strings and compares them by pointer', () => {
    const source = [
      'let greeting = "hello"',
      'let same = "hello"',
      'let other = "world"',
      'let check = greeting == same',
      'let differs = greeting == other',
    ].join('\n')

    const ir = generate(source)

    expect(ir).toContain('@.str.0 = private unnamed_addr constant [6 x i8] c"hello\\00"')
    expect(ir).toContain('@.str.1 = private unnamed_addr constant [6 x i8] c"world\\00"')
    expect(ir).toContain('%t5 = icmp eq ptr %t3, %t4')
    expect(ir).toContain('%t8 = icmp eq ptr %t6, %t7')
  })

  it('generates short-circuit logical expressions', () => {
    const source = [
      'let a = true',
      'let b = false',
      'let both = a && b',
      'let either = a || b',
    ].join('\n')

    expect(generate(source)).toBe(
      [
        'define i32 @main() {',
        'entry:',
        '  %a.addr = alloca i1',
        '  %b.addr = alloca i1',
        '  %and.addr = alloca i1',
        '  %both.addr = alloca i1',
        '  %or.addr = alloca i1',
        '  %either.addr = alloca i1',
        '  store i1 1, ptr %a.addr',
        '  store i1 0, ptr %b.addr',
        '  %t0 = load i1, ptr %a.addr',
        '  store i1 %t0, ptr %and.addr',
        '  br i1 %t0, label %and.right, label %and.end',
        'and.right:',
        '  %t1 = load i1, ptr %b.addr',
        '  store i1 %t1, ptr %and.addr',
        '  br label %and.end',
        'and.end:',
        '  %t2 = load i1, ptr %and.addr',
        '  store i1 %t2, ptr %both.addr',
        '  %t3 = load i1, ptr %a.addr',
        '  store i1 %t3, ptr %or.addr',
        '  br i1 %t3, label %or.end, label %or.right',
        'or.right:',
        '  %t4 = load i1, ptr %b.addr',
        '  store i1 %t4, ptr %or.addr',
        '  br label %or.end',
        'or.end:',
        '  %t5 = load i1, ptr %or.addr',
        '  store i1 %t5, ptr %either.addr',
        '  ret i32 0',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('generates conditional expressions', () => {
    const source = ['let a = 1', 'let label = a > 0 ? "pos" : "neg"'].join('\n')

    expect(generate(source)).toBe(
      [
        '@.str.0 = private unnamed_addr constant [4 x i8] c"pos\\00"',
        '',
        '@.str.1 = private unnamed_addr constant [4 x i8] c"neg\\00"',
        '',
        'define i32 @main() {',
        'entry:',
        '  %a.addr = alloca double',
        '  %cond.addr = alloca ptr',
        '  %label.addr = alloca ptr',
        '  store double 1.0, ptr %a.addr',
        '  %t0 = load double, ptr %a.addr',
        '  %t1 = fcmp ogt double %t0, 0.0',
        '  br i1 %t1, label %cond.true, label %cond.false',
        'cond.true:',
        '  %t2 = getelementptr inbounds [4 x i8], ptr @.str.0, i64 0, i64 0',
        '  store ptr %t2, ptr %cond.addr',
        '  br label %cond.end',
        'cond.false:',
        '  %t3 = getelementptr inbounds [4 x i8], ptr @.str.1, i64 0, i64 0',
        '  store ptr %t3, ptr %cond.addr',
        '  br label %cond.end',
        'cond.end:',
        '  %t4 = load ptr, ptr %cond.addr',
        '  store ptr %t4, ptr %label.addr',
        '  ret i32 0',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('generates void functions', () => {
    const source = ['function reset(): void {', '  return', '}', '', 'reset()'].join('\n')

    expect(generate(source)).toBe(
      [
        'define void @reset() {',
        'entry:',
        '  ret void',
        '}',
        '',
        'define i32 @main() {',
        'entry:',
        '  call void @reset()',
        '  ret i32 0',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('emits unreachable for code after a return', () => {
    const source = ['function sample(): number {', '  return 1', '  let unused = 2', '}'].join('\n')

    expect(generate(source)).toBe(
      [
        'define double @sample() {',
        'entry:',
        '  %unused.addr = alloca double',
        '  ret double 1.0',
        'dead:',
        '  store double 2.0, ptr %unused.addr',
        '  unreachable',
        '}',
        '',
        'define i32 @main() {',
        'entry:',
        '  ret i32 0',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('uses the configured entry name', () => {
    expect(generate('let a = 1', 'start')).toContain('define i32 @start() {')
  })

  it('generates print calls for numbers', () => {
    const ir = generate('print(42)')

    expect(ir).toContain('declare i32 @printf(ptr, ...)')
    expect(ir).toContain('@.str.0 = private unnamed_addr constant [4 x i8] c"%f\\0A\\00"')
    expect(ir).toContain('%t1 = call i32 (ptr, ...) @printf(ptr %t0, double 42.0)')
  })

  it('generates print calls for strings and booleans', () => {
    const ir = generate('print("hi")\nprint(true)')

    expect(ir).toContain('%t2 = call i32 (ptr, ...) @printf(ptr %t1, ptr %t0)')
    expect(ir).toContain('%t6 = select i1 1, ptr %t4, ptr %t5')
    expect(ir).toContain('%t7 = call i32 (ptr, ...) @printf(ptr %t3, ptr %t6)')
  })

  it('rejects invalid builtin calls', () => {
    expect(() => generate('print()')).toThrow('expects 1 arguments')
    expect(() => generate('print(1, 2)')).toThrow('expects 1 arguments')
    expect(() => generate('function reset(): void { }\nprint(reset())')).toThrow('does not accept')
  })

  it('rejects unknown variables', () => {
    expect(() => generate('x = 1')).toThrow("Unknown variable 'x'.")
  })

  it('rejects unknown functions', () => {
    expect(() => generate('foo()')).toThrow("Unknown function 'foo'.")
  })

  it('rejects functions without type annotations', () => {
    expect(() => generate('function f(a) { }')).toThrow('return type annotation')
    expect(() => generate('function f(a): number { return 0 }')).toThrow(
      'requires a type annotation',
    )
  })

  it('rejects reserved function names', () => {
    expect(() => generate('function main(): void { }')).toThrow('reserved')
  })

  it('rejects nested functions', () => {
    expect(() => generate('function outer(): void { function inner(): void { } }')).toThrow(
      'Nested functions',
    )
  })

  it('rejects string concatenation', () => {
    expect(() => generate('let s = "a" + "b"')).toThrow('String concatenation')
  })

  it('rejects top-level returns', () => {
    expect(() => generate('return 1')).toThrow('Return outside')
  })

  it('rejects conflicting variable types', () => {
    expect(() => generate('let x = 1\nx = "hi"')).toThrow('cannot be assigned string')
    expect(() => generate('let x: number = "hi"')).toThrow('conflicting type')
  })

  it('rejects break and continue outside of loops', () => {
    expect(() => generate('break')).toThrow('Break outside')
    expect(() => generate('continue')).toThrow('Continue outside')
  })

  it('rejects unsupported expressions', () => {
    expect(() => generate('let v = [1, 2]')).toThrow('Unsupported expression')
  })
})
