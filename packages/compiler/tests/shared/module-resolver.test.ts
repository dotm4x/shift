import { describe, expect, it } from 'vitest'

import { ModuleResolver } from '../../source/shared/module-resolver.js'

describe('ModuleResolver', () => {
  it('resolves relative specifiers', () => {
    const resolver = new ModuleResolver()

    expect(resolver.resolve('./math', 'src/lib/main.shift')).toBe('src/lib/./math')
    expect(resolver.resolve('../util', 'src/lib/main.shift')).toBe('src/lib/../util')
  })

  it('resolves alias specifiers', () => {
    const resolver = new ModuleResolver({ aliases: [{ prefix: 'packages', base: 'vendor' }] })

    expect(resolver.resolve('packages:colorify', 'src')).toBe('vendor/colorify')
  })

  it('throws for unknown aliases', () => {
    const resolver = new ModuleResolver()

    expect(() => resolver.resolve('packages:colorify', 'src')).toThrow(/Unknown import specifier/)
  })

  it('resolves installed package names', () => {
    const resolver = new ModuleResolver({
      packages: new Map([
        ['@fable/core', 'store/abc123'],
        ['@fable/core/graphics', 'store/def456'],
      ]),
    })

    expect(resolver.resolve('@fable/core', 'src')).toBe('store/abc123')
    expect(resolver.resolve('@fable/core/graphics', 'src')).toBe('store/def456')
    expect(resolver.resolve('@fable/core/graphics/render', 'src')).toBe('store/def456/render')
    expect(resolver.resolve('@fable/core/math', 'src')).toBe('store/abc123/math')
  })

  it('throws for unknown package specifiers', () => {
    const resolver = new ModuleResolver({ packages: new Map([['core', 'store/abc123']]) })

    expect(() => resolver.resolve('missing', 'src')).toThrow(/Unknown import specifier/)
  })
})
