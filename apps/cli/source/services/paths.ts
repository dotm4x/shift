import { isAbsolute, resolve } from 'node:path'

/**
 * Resolves a path against the directory where the CLI was invoked, because pnpm runs workspace
 * scripts from their package directory.
 *
 * @param path Path to resolve, absolute or relative to the invocation directory.
 * @returns Absolute path.
 */
export function resolveInvocationPath(path: string): string {
  if (isAbsolute(path)) {
    return path
  }

  return resolve(process.env.INIT_CWD ?? process.cwd(), path)
}
