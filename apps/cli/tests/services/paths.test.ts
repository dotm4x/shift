import { describe, expect, it } from 'vitest'

import { resolveInvocationPath } from '../../source/services/paths.js'

describe('resolveInvocationPath', () => {
  it('keeps absolute paths as-is', () => {
    expect(resolveInvocationPath('/tmp/sample.ls')).toBe('/tmp/sample.ls')
  })

  it('resolves relative paths against INIT_CWD', () => {
    const previous = process.env.INIT_CWD
    process.env.INIT_CWD = '/tmp'

    try {
      expect(resolveInvocationPath('sample.ls')).toBe('/tmp/sample.ls')
    } finally {
      if (previous === undefined) {
        delete process.env.INIT_CWD
      } else {
        process.env.INIT_CWD = previous
      }
    }
  })

  it('resolves relative paths against the working directory by default', () => {
    const previous = process.env.INIT_CWD
    delete process.env.INIT_CWD

    try {
      expect(resolveInvocationPath('sample.ls')).toBe(`${process.cwd()}/sample.ls`)
    } finally {
      if (previous !== undefined) {
        process.env.INIT_CWD = previous
      }
    }
  })
})
