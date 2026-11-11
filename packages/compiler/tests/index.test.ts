import { describe, expect, it } from 'vitest'

import * as compiler from '../source/index.js'

describe('compiler package', () => {
  it('is importable', () => {
    expect(compiler).toBeTypeOf('object')
  })
})
