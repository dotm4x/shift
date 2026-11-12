import { describe, expect, it } from 'vitest'

import {
  parseProjectManifest,
  ProjectManifestError,
  serializeProjectManifest,
} from '../../source/manifest/project-manifest.js'

describe('parseProjectManifest', () => {
  it('parses a minimal manifest with defaults', () => {
    const manifest = parseProjectManifest('{"name":"my-project","version":"1.0.0"}')

    expect(manifest.name).toBe('my-project')
    expect(manifest.version).toBe('1.0.0')
    expect(manifest.type).toBe('library')
  })

  it('parses a full manifest', () => {
    const manifest = parseProjectManifest(
      JSON.stringify({
        name: '@fable/core/graphics',
        version: '2.1.0',
        description: 'Graphics',
        type: 'executable',
        entry: 'src/main.ls',
        sdk: '0.1.0',
        dependencies: { http: '^1.0.0' },
        developmentDependencies: { testing: '~2.0.0' },
        build: { target: 'native', output: 'build', optimization: 'release' },
        compiler: { globals: ['print'] },
      }),
    )

    expect(manifest.name).toBe('@fable/core/graphics')
    expect(manifest.type).toBe('executable')
    expect(manifest.dependencies?.http).toBe('^1.0.0')
    expect(manifest.developmentDependencies?.testing).toBe('~2.0.0')
    expect(manifest.build?.optimization).toBe('release')
    expect(manifest.compiler?.globals).toEqual(['print'])
  })

  it('rejects invalid JSON', () => {
    expect(() => parseProjectManifest('{')).toThrow(ProjectManifestError)
  })

  it('rejects a non-object manifest', () => {
    expect(() => parseProjectManifest('[]')).toThrow(ProjectManifestError)
  })

  it('rejects a missing name', () => {
    expect(() => parseProjectManifest('{"version":"1.0.0"}')).toThrow(ProjectManifestError)
  })

  it('rejects an invalid version', () => {
    expect(() => parseProjectManifest('{"name":"a","version":"1.0"}')).toThrow(ProjectManifestError)
  })

  it('rejects an invalid type', () => {
    expect(() => parseProjectManifest('{"name":"a","version":"1.0.0","type":"binary"}')).toThrow(
      ProjectManifestError,
    )
  })

  it('rejects invalid dependency constraints', () => {
    expect(() =>
      parseProjectManifest('{"name":"a","version":"1.0.0","dependencies":{"b":""}}'),
    ).toThrow(ProjectManifestError)
  })

  it('rejects invalid build optimization', () => {
    expect(() =>
      parseProjectManifest('{"name":"a","version":"1.0.0","build":{"optimization":"turbo"}}'),
    ).toThrow(ProjectManifestError)
  })

  it('parses scripts', () => {
    const manifest = parseProjectManifest(
      '{"name":"a","version":"1.0.0","scripts":{"start":"run src/main.ls"}}',
    )

    expect(manifest.scripts?.start).toBe('run src/main.ls')
  })

  it('rejects empty script commands', () => {
    expect(() =>
      parseProjectManifest('{"name":"a","version":"1.0.0","scripts":{"start":""}}'),
    ).toThrow(ProjectManifestError)
  })
})

describe('serializeProjectManifest', () => {
  it('round-trips a manifest', () => {
    const manifest = parseProjectManifest('{"name":"a","version":"1.0.0","type":"library"}')

    expect(parseProjectManifest(serializeProjectManifest(manifest))).toEqual(manifest)
  })
})
