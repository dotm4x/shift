# Contributing

These guidelines apply across the workspace. Follow any additional guidance in the directory or
package you are changing.

## Setup and checks

Use Node.js 22 and the pnpm version specified in [package.json](./package.json). Install workspace
dependencies with `pnpm install`.

Before submitting changes, run the workspace quality checks:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
```

Run the relevant project's tests and build when its code or configuration changes. Use
`pnpm --filter <project-name> <script>` and check that project's `package.json` for the available
scripts. Add or update tests for behavior changes and cover relevant edge cases.

`pnpm lint` builds workspace projects first so their dependencies and types resolve on a fresh
checkout, while `pnpm lint:files` checks files without building. `pnpm format` formats the
workspace and `pnpm lint:fix` applies available ESLint fixes. Review automated changes before
submitting them. To check specific files, pass paths to `pnpm format:files <paths>` and
`pnpm lint:files <paths>`.

## Code style

- Write clear, descriptive names. Use PascalCase for types, camelCase for variables, functions,
  methods, and properties, and descriptive `T`-prefixed PascalCase names such as `TValue` for
  generic parameters. Do not prefix interface names with `I`.
- Prefer natural boolean names such as `active`, `visible`, and `enabled` over redundant
  prefixes such as `is`, `has`, `can`, or `should`.
- Prefer immutable values and `readonly` properties where practical. Declare class member
  accessibility and field types explicitly, and specify return types at module boundaries.
- Prefix private class fields, including constructor parameter properties, with `_` followed by
  camelCase; for example, `_handler`. Private methods remain camelCase without the prefix.
- Name files using their directory's context rather than repeating it: for example, use
  `parser/context.ts` for `ParseContext`. This convention applies to filenames, not type names.
- Keep modules cohesive: declare dependencies where they are used, import only what you need,
  use type-only imports where appropriate, and avoid circular dependencies.
- Preserve type safety: avoid `any`, unsafe assertions, non-null assertions, and unhandled
  promises. Handle errors explicitly and throw `Error` objects.
- Keep APIs predictable and changes focused. Prefer simple functions or composition over
  abstractions and inheritance that do not provide a clear benefit.
- Document public behavior, parameters, return values, and relevant edge cases. Keep comments
  useful and avoid duplicating inherited documentation.

[eslint.config.mjs](./eslint.config.mjs) is the authoritative source for lint rules and
[.prettierrc.json](./.prettierrc.json) for formatting. Prettier owns token-level formatting;
ESLint enforces structure and quality, and its stylistic rules only manage blank lines, so the
two tools never format the same text. Do not add ESLint rules that duplicate Prettier. Omit
optional semicolons in JavaScript and TypeScript; Prettier retains them where needed for correct
parsing. `TODO` and `FIXME` comments are reported as warnings, so use them deliberately.

## Code organization

The conventions below are enforced by ESLint and applied with `pnpm lint:fix`. `.editorconfig`
mirrors the formatting settings for editors, and the checked-in VS Code settings format with
Prettier and apply ESLint fixes on save.

### Imports and exports

Imports are sorted into groups separated by one blank line:

1. Node.js built-in modules
2. External packages
3. Internal modules: aliases declared by the project and workspace packages
4. Parent-directory imports (`../`)
5. Sibling and index imports (`./`)

Named imports and exports are sorted, type-only imports stay inline with value imports, and
re-export statements are sorted by module path. Side-effect imports keep their position.

### Class members

Classes declare members in this order, preserving declaration order within each group:

1. Index signatures and static blocks
2. Static fields
3. Instance fields
4. Constructors
5. Getters and setters
6. Static methods
7. Public methods
8. Protected methods
9. Private methods

Private backing fields come before the public fields and accessors that expose them. Separate
multi-line members with a blank line, but keep consecutive single-line fields compact.

### Interfaces, types, and objects

Interface and object type members list required members before optional members, preserving
declaration order within each group. Object literals keep their authored order because option
objects mirror the constructor or function they configure; only type declarations are reordered.

### Blank lines

Use a single blank line between logical sections: after a multi-line `if`, `for`, `while`,
`switch`, or `try` block, after a multi-line function declaration, and between multi-line class
members. Do not stack blank lines; Prettier keeps at most one. Single-line guard clauses stay next
to the statement they protect.

## Workspace layout

Keep dependencies and scripts in the project that uses them, and do not commit generated output,
dependencies, or secrets.

Workspace projects follow the same layout: TypeScript sources live under `source/`, configuration
and tests sit next to that project's `package.json`, and each project owns its type-check
configuration. Executables live under `apps/`: build the CLI with
`pnpm --filter @shift/cli build` and run it with `pnpm shiftc <command>`, for example
`pnpm shiftc run sample.shift`. The `sandbox/` project is a plain Node.js scratch space for
trying code; do not turn it into a standalone application.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) messages, for example
`feat: add input validation` or `fix: handle empty input`. The pre-commit hook formats and lints
staged files, and the commit-message hook checks the message with Commitlint. Keep each commit
focused on one logical change; do not combine unrelated changes in the same commit.
