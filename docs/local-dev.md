# Local Development

## Prerequisites

- Node.js compatible with the installed pnpm toolchain.
- pnpm `10.30.3`, as declared in the root `package.json`.
- Linux or WSL for the eventual Podman runtime path.

The current repository skeleton does not require Podman to run typechecks or
tests. Podman will be required when the runtime adapter is implemented.

## Install

```bash
pnpm install
```

Use `pnpm install --offline` when only workspace links changed and the lockfile
already contains all external packages.

## Common Commands

```bash
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
```

Package-scoped examples:

```bash
pnpm --filter @sando/shared typecheck
pnpm --filter @sando/runtimes typecheck
pnpm test -- packages/shared/src/index.test.ts
```

## Current Check Notes

`pnpm check` runs format, lint, typecheck, and tests. At the time these docs were
added, the repo-wide format check stops on `docs/high-level-design.md`, which is
an existing design document. For scoped changes, validate touched files directly:

```bash
pnpm exec oxfmt --check packages/shared/src/index.ts packages/shared/src/index.test.ts docs/architecture.md docs/local-dev.md todo.txt
```

## Adding Shared Contracts

Put cross-boundary API contracts in `packages/shared` when they are needed by
more than one app or package. Keep shared code small and keep Zod schemas as the
source of truth for validated contracts.

When adding schema helpers:

1. Export literal arrays for allowed values.
2. Export Zod schemas for validated objects and scalar refinements.
3. Export TypeScript types with `z.infer<typeof schema>`.
4. Export parser and type-guard helpers around `schema.safeParse`.
5. Return `Result<T>` with `VALIDATION_FAILED` for invalid input.
6. Add focused Vitest coverage in `packages/shared/src`.

## Adding Runtime Code

Runtime implementations should live behind `SandboxRuntime` from
`packages/runtimes`.

Adapters should:

- avoid writing directly to the user's working tree;
- take a workspace archive as input;
- capture stdout, stderr, logs, result metadata, diffs, and configured
  artifacts;
- destroy local resources after each run;
- return structured `Result` values for expected failures.

## Todo Workflow

The repository tracks bootstrapping work in `todo.txt`. Complete items in order,
mark each item with `[x]` after implementation, and run the narrowest useful
checks before moving to the next item.
