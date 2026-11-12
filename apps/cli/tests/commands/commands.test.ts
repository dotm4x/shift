import { describe, expect, it } from 'vitest'

import { buildCommand } from '../../source/commands/build.js'
import { runCommand } from '../../source/commands/run.js'
import { scriptCommand } from '../../source/commands/script.js'

describe('buildCommand', () => {
  it('registers the build command with an output option', () => {
    const command = buildCommand()

    expect(command.name()).toBe('build')
    expect(command.options.some((option) => option.long === '--output')).toBe(true)
  })
})

describe('runCommand', () => {
  it('registers the run command', () => {
    expect(runCommand().name()).toBe('run')
  })
})

describe('scriptCommand', () => {
  it('registers the script command', () => {
    expect(scriptCommand().name()).toBe('script')
  })
})
