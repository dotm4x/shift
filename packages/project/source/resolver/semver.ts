/** A parsed semantic version. */
export interface SemanticVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
}

/**
 * Parses a semantic version string.
 *
 * @param version Version string.
 * @returns The parsed version, or `undefined` when invalid.
 */
export function parseSemanticVersion(version: string): SemanticVersion | undefined {
  const match =
    /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+.+)?$/.exec(
      version,
    )

  if (match?.groups === undefined) {
    return undefined
  }

  const { major, minor, patch, prerelease } = match.groups

  if (major === undefined || minor === undefined || patch === undefined) {
    return undefined
  }

  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
    prerelease: prerelease === undefined ? [] : prerelease.split('.'),
  }
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0
  }

  if (left.length === 0) {
    return 1
  }

  if (right.length === 0) {
    return -1
  }

  const length = Math.min(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] ?? ''
    const rightPart = right[index] ?? ''
    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)

    if (leftNumeric && rightNumeric) {
      const difference = Number.parseInt(leftPart, 10) - Number.parseInt(rightPart, 10)

      if (difference !== 0) {
        return difference
      }
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1
    } else {
      if (leftPart < rightPart) {
        return -1
      }

      if (leftPart > rightPart) {
        return 1
      }
    }
  }

  return left.length - right.length
}

/**
 * Compares two semantic versions.
 *
 * @returns Negative when left < right, positive when left > right, zero when equal.
 */
export function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  if (left.major !== right.major) {
    return left.major - right.major
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor
  }

  if (left.patch !== right.patch) {
    return left.patch - right.patch
  }

  return comparePrerelease(left.prerelease, right.prerelease)
}

/**
 * Returns true when `version` satisfies `constraint`.
 *
 * Supports: exact, `*`, `^`, `~`, `>=`, `<=`, `>`, `<`, and space-separated AND ranges.
 */
export function satisfies(version: string, constraint: string): boolean {
  const parsedVersion = parseSemanticVersion(version)

  if (parsedVersion === undefined) {
    return false
  }

  const trimmed = constraint.trim()

  if (trimmed === '' || trimmed === '*' || trimmed === 'latest') {
    return true
  }

  const parts = trimmed.split(/\s+/)

  return parts.every((part) => satisfiesSingle(parsedVersion, part))
}

function satisfiesSingle(version: SemanticVersion, constraint: string): boolean {
  if (constraint.startsWith('^')) {
    const base = parseSemanticVersion(constraint.slice(1))

    if (base === undefined) {
      return false
    }

    if (compareSemanticVersions(version, base) < 0) {
      return false
    }

    if (base.major > 0) {
      return version.major === base.major
    }

    if (base.minor > 0) {
      return version.major === 0 && version.minor === base.minor
    }

    return version.major === 0 && version.minor === 0 && version.patch === base.patch
  }

  if (constraint.startsWith('~')) {
    const base = parseSemanticVersion(constraint.slice(1))

    if (base === undefined) {
      return false
    }

    if (compareSemanticVersions(version, base) < 0) {
      return false
    }

    return version.major === base.major && version.minor === base.minor
  }

  if (constraint.startsWith('>=')) {
    const base = parseSemanticVersion(constraint.slice(2))

    return base !== undefined && compareSemanticVersions(version, base) >= 0
  }

  if (constraint.startsWith('<=')) {
    const base = parseSemanticVersion(constraint.slice(2))

    return base !== undefined && compareSemanticVersions(version, base) <= 0
  }

  if (constraint.startsWith('>')) {
    const base = parseSemanticVersion(constraint.slice(1))

    return base !== undefined && compareSemanticVersions(version, base) > 0
  }

  if (constraint.startsWith('<')) {
    const base = parseSemanticVersion(constraint.slice(1))

    return base !== undefined && compareSemanticVersions(version, base) < 0
  }

  const base = parseSemanticVersion(constraint)

  if (base === undefined) {
    return false
  }

  return compareSemanticVersions(version, base) === 0
}
