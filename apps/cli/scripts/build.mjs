import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Forwards arguments to the livescript build command, and compiles the CLI itself when called
// without them, so `pnpm --filter @livescript/cli build <file>` compiles a Livescript file.
const args = process.argv.slice(2)
const directory = dirname(dirname(fileURLToPath(import.meta.url)))
const cli = join(directory, 'dist', 'main.js')

if (args.length === 0) {
  const compiled = spawnSync('pnpm', ['run', 'compile'], { shell: true, stdio: 'inherit' })
  process.exit(compiled.status ?? 1)
}

if (!existsSync(cli)) {
  console.error('The CLI is not built yet. Run `pnpm build` at the workspace root first.')
  process.exit(1)
}

const forwarded = spawnSync(process.execPath, [cli, 'build', ...args], { stdio: 'inherit' })
process.exit(forwarded.status ?? 1)
