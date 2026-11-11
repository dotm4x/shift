# Agent guidelines

- Follow [CONTRIBUTING.md](./CONTRIBUTING.md) for workspace-wide style, testing, and commit
  conventions. Check for more specific instructions in the directories being changed.
- Inspect existing code and preserve public behavior and unrelated work. Keep changes focused,
  use existing patterns, and update directly affected documentation and tests.
- Keep package-specific dependencies, tests, and scripts in their package; see
  [packages/README.md](./packages/README.md) for TypeScript project setup.
- Run the relevant checks from [CONTRIBUTING.md](./CONTRIBUTING.md). Report any checks that
  could not be run or failures that remain.
- Do not suppress type or lint errors as a shortcut; address their cause.
- Do not add `Co-authored-by` trailers to commit messages.
- Mirror the source directory structure under tests: place tests for each `.ts` source file in
  its corresponding `.test.ts` file, adding cases there instead of creating redundant test files.
