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
    const source = ['let a = 1', 'let b = 2', 'let total = a + b * 2'].join('\n')

    expect(generate(source)).toBe(
      [
        'define i32 @main() {',
        'entry:',
        '  %a.addr = alloca i32',
        '  %b.addr = alloca i32',
        '  %total.addr = alloca i32',
        '  store i32 1, ptr %a.addr',
        '  store i32 2, ptr %b.addr',
        '  %t0 = load i32, ptr %a.addr',
        '  %t1 = load i32, ptr %b.addr',
        '  %t2 = mul i32 %t1, 2',
        '  %t3 = add i32 %t0, %t2',
        '  store i32 %t3, ptr %total.addr',
        '  ret i32 0',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('generates functions with calls and recursion', () => {
    const source = [
      'function factorial(n: i64): i64 {',
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
        'define i64 @factorial(i64 %n) {',
        'entry:',
        '  %n.addr = alloca i64',
        '  store i64 %n, ptr %n.addr',
        '  %t0 = load i64, ptr %n.addr',
        '  %t1 = icmp sle i64 %t0, 1',
        '  br i1 %t1, label %if.then, label %if.end',
        'if.then:',
        '  ret i64 1',
        'if.end:',
        '  %t2 = load i64, ptr %n.addr',
        '  %t3 = load i64, ptr %n.addr',
        '  %t4 = sub i64 %t3, 1',
        '  %t5 = call i64 @factorial(i64 %t4)',
        '  %t6 = mul i64 %t2, %t5',
        '  ret i64 %t6',
        '}',
        '',
        'define i32 @main() {',
        'entry:',
        '  %result.addr = alloca i64',
        '  %t0 = call i64 @factorial(i64 5)',
        '  store i64 %t0, ptr %result.addr',
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
        '  %i.addr = alloca i32',
        '  %total.addr = alloca i32',
        '  store i32 0, ptr %i.addr',
        '  store i32 0, ptr %total.addr',
        '  br label %while.cond',
        'while.cond:',
        '  br i1 1, label %while.body, label %while.end',
        'while.body:',
        '  %t0 = load i32, ptr %i.addr',
        '  %t1 = add i32 %t0, 1',
        '  store i32 %t1, ptr %i.addr',
        '  %t2 = load i32, ptr %i.addr',
        '  %t3 = icmp sgt i32 %t2, 3',
        '  br i1 %t3, label %if.then, label %if.end',
        'if.then:',
        '  br label %while.end',
        'if.end:',
        '  %t4 = load i32, ptr %i.addr',
        '  %t5 = icmp eq i32 %t4, 2',
        '  br i1 %t5, label %if.then.1, label %if.end.1',
        'if.then.1:',
        '  br label %while.cond',
        'if.end.1:',
        '  %t6 = load i32, ptr %total.addr',
        '  %t7 = load i32, ptr %i.addr',
        '  %t8 = add i32 %t6, %t7',
        '  store i32 %t8, ptr %total.addr',
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
        '  %total.addr = alloca i32',
        '  %i.addr = alloca i32',
        '  store i32 0, ptr %total.addr',
        '  store i32 0, ptr %i.addr',
        '  br label %for.cond',
        'for.cond:',
        '  %t0 = load i32, ptr %i.addr',
        '  %t1 = icmp slt i32 %t0, 3',
        '  br i1 %t1, label %for.body, label %for.end',
        'for.body:',
        '  %t2 = load i32, ptr %total.addr',
        '  %t3 = load i32, ptr %i.addr',
        '  %t4 = add i32 %t2, %t3',
        '  store i32 %t4, ptr %total.addr',
        '  br label %for.inc',
        'for.inc:',
        '  %t5 = load i32, ptr %i.addr',
        '  %t6 = add i32 %t5, 1',
        '  store i32 %t6, ptr %i.addr',
        '  br label %for.cond',
        'for.end:',
        '  ret i32 0',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('compares strings by content', () => {
    const source = [
      'let greeting = "hello"',
      'let same = "hello"',
      'let check = greeting == same',
    ].join('\n')

    const ir = generate(source)

    expect(ir).toContain('declare i32 @strcmp(ptr, ptr)')
    expect(ir).toContain('%t4 = call i32 @strcmp(ptr %t2, ptr %t3)')
    expect(ir).toContain('%t5 = icmp eq i32 %t4, 0')
  })

  it('generates short-circuit logical expressions', () => {
    const source = ['let a = true', 'let b = false', 'let both = a && b'].join('\n')

    expect(generate(source)).toBe(
      [
        'define i32 @main() {',
        'entry:',
        '  %a.addr = alloca i1',
        '  %b.addr = alloca i1',
        '  %and.addr = alloca i1',
        '  %both.addr = alloca i1',
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
        '  %a.addr = alloca i32',
        '  %cond.addr = alloca ptr',
        '  %label.addr = alloca ptr',
        '  store i32 1, ptr %a.addr',
        '  %t0 = load i32, ptr %a.addr',
        '  %t1 = icmp sgt i32 %t0, 0',
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

  it('generates print calls for numbers', () => {
    const ir = generate('print(42)')

    expect(ir).toContain('declare i32 @printf(ptr, ...)')
    expect(ir).toContain('@.str.0 = private unnamed_addr constant [4 x i8] c"%d\\0A\\00"')
    expect(ir).toContain('%t1 = call i32 (ptr, ...) @printf(ptr %t0, i32 42)')
  })

  it('generates print calls for strings and booleans', () => {
    const ir = generate('print("hi")\nprint(true)')

    expect(ir).toContain('%t2 = call i32 (ptr, ...) @printf(ptr %t1, ptr %t0)')
    expect(ir).toContain('%t6 = select i1 1, ptr %t4, ptr %t5')
  })

  it('generates casts between numeric types', () => {
    const source = [
      'let big: i64 = 1',
      'let small = big as i32',
      'let decimal = small as f64',
    ].join('\n')

    expect(generate(source)).toContain('%t1 = trunc i64 %t0 to i32')
    expect(generate(source)).toContain('%t3 = sitofp i32 %t2 to double')
  })

  it('generates arrays with bounds-checked indexing', () => {
    const source = [
      'let items: i32[] = [10, 20]',
      'let first = items[0]',
      'let count = items.length',
    ].join('\n')

    const ir = generate(source)

    expect(ir).toContain('declare ptr @GC_malloc(i64)')
    expect(ir).toContain('%t0 = call ptr @GC_malloc(i64 16)')
    expect(ir).toContain('icmp uge i64')
    expect(ir).toContain('load i32, ptr')
    expect(ir).toContain('load i64, ptr')
  })

  it('concatenates strings with the garbage collector', () => {
    const ir = generate('let greeting = "hi" + " " + "there"')

    expect(ir).toContain('declare i64 @strlen(ptr)')
    expect(ir).toContain('declare void @llvm.memcpy.p0.p0.i64(ptr, ptr, i64, i1)')
    expect(ir).toContain('call ptr @GC_malloc(i64')
  })

  it('generates classes with fields, methods and constructors', () => {
    const source = [
      'class Car {',
      '  year: i32',
      '',
      '  constructor(year: i32) {',
      '    this.year = year',
      '  }',
      '',
      '  age(current: i32): i32 {',
      '    return current - this.year',
      '  }',
      '}',
      '',
      'let car = new Car(67)',
      'print(car.age(100))',
    ].join('\n')

    const ir = generate(source)

    expect(ir).toContain('%Car = type { ptr, i32 }')
    expect(ir).toContain('@Car.vt = private unnamed_addr constant [1 x ptr] [ ptr @Car.age ]')
    expect(ir).toContain('define void @Car.constructor(ptr %this, i32 %year) {')
    expect(ir).toContain('define i32 @Car.age(ptr %this, i32 %current) {')
    expect(ir).toContain('%t0 = call ptr @GC_malloc(i64 12)')
    expect(ir).toContain('call void @Car.constructor(ptr %t0, i32 67)')
    expect(ir).toContain('call i32 %t6(ptr %t2, i32 100)')
  })

  it('generates try and catch with longjmp', () => {
    const source = [
      'try {',
      '  print("inside")',
      '} catch (message: string) {',
      '  print(message)',
      '}',
    ].join('\n')

    const ir = generate(source)

    expect(ir).toContain('declare i32 @setjmp(ptr) #0')
    expect(ir).toContain('declare void @longjmp(ptr, i32)')
    expect(ir).toContain('@livescript.handlers = global [64 x ptr] zeroinitializer')
    expect(ir).toContain('call i32 @setjmp(ptr')
    expect(ir).toContain('attributes #0 = { returns_twice }')
  })

  it('uses the configured entry name', () => {
    expect(generate('let a = 1', 'start')).toContain('define i32 @start() {')
  })

  it('generates object literals with member access and calls', () => {
    const source = ['const point = { x: 1, y: 2 }', 'let sum = point.x + point.y'].join('\n')

    const ir = generate(source)

    expect(ir).toContain('call ptr @GC_malloc(i64 16)')
    expect(ir).toContain('store i64 2, ptr %t0')
    expect(ir).toContain('add i32')
  })

  it('generates calls through object properties', () => {
    const source = [
      'function double(value: i32): i32 {',
      '  return value * 2',
      '}',
      '',
      'const ops = { twice: double }',
      'let result = ops.twice(21)',
    ].join('\n')

    const ir = generate(source)

    expect(ir).toContain('call ptr @GC_malloc(i64 16)')
    expect(ir).toContain('call i32 %t')
  })

  it('generates external namespace calls', () => {
    const source = 'let value = Serial.encode(1)'

    const ir = new Generator().generate(new Parser().parse(source, new DiagnosticBag()), {
      globals: ['Serial'],
    })

    expect(ir).toContain('call i32 @Serial.encode(i32 1)')
  })

  it('rejects unknown variables', () => {
    expect(() => generate('x = 1')).toThrow("Unknown variable 'x'.")
  })

  it('rejects unknown functions', () => {
    expect(() => generate('foo()')).toThrow("Unknown function 'foo'.")
  })

  it('rejects functions without type annotations', () => {
    expect(() => generate('function f(a) { }')).toThrow('return type annotation')
    expect(() => generate('function f() { return 1 }')).toThrow('return type annotation')
  })

  it('rejects reserved function names', () => {
    expect(() => generate('function main(): void { }')).toThrow('reserved')
  })

  it('generates nested functions', () => {
    const source = [
      'function outer(): i32 {',
      '  function inner(): i32 {',
      '    return 7',
      '  }',
      '',
      '  return inner()',
      '}',
      '',
      'let value = outer()',
    ].join('\n')

    const ir = generate(source)

    expect(ir).toContain('define i32 @main.inner() {')
    expect(ir).toContain('call i32 %t')
  })

  it('rejects mixed-type arithmetic', () => {
    expect(() => generate('let a = 1\nlet b = 2.5\nlet total = a + b')).toThrow(
      'Operands must have the same type',
    )
  })

  it('rejects conflicting variable types', () => {
    expect(() => generate('let x = 1\nx = "hi"')).toThrow('Cannot assign')
    expect(() => generate('let x: i32 = "hi"')).toThrow('Cannot assign')
  })

  it('generates tuple literals with element access', () => {
    const source = ['let pair = [1, "hi"]', 'let number = pair.0', 'let text = pair.1'].join('\n')

    const ir = generate(source)

    expect(ir).toContain('call ptr @GC_malloc(i64 20)')
    expect(ir).toContain('store i32 1, ptr')
    expect(ir).toContain('store ptr %t')
  })

  it('collects only exported function signatures', () => {
    const source = [
      'export function visible(value: i32): i32 {',
      '  return value',
      '}',
      '',
      'function hidden(value: i32): i32 {',
      '  return value',
      '}',
    ].join('\n')
    const file = new Parser().parse(source, new DiagnosticBag())
    const signatures = new Generator().signaturesOf(file)

    expect([...signatures.keys()]).toEqual(['visible'])
  })
})
