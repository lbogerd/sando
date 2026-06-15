# Local Development

## Prerequisites

- Node.js compatible with the installed pnpm toolchain.
- pnpm `10.30.3`, as declared in the root `package.json`.
- Linux or WSL for the eventual Podman runtime path.

Most repository checks do not require Podman. Runtime tests use injectable
command runners, and the diagnostics spike reports local Podman health without
requiring the test suite to shell out to a real Podman install.

## Install

```bash
pnpm install
```

Use `pnpm install --offline` when only workspace links changed and the lockfile
already contains all external packages.

## Common Commands

```bash
pnpm dev
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

## Local Hosted Stack

Use the root dev script to start the hosted API with a local Postgres database:

```bash
pnpm dev
```

By default this starts a Podman Postgres container named
`sandhost-postgres`, waits for it to become ready, then starts the Hono API at
`http://127.0.0.1:3000`. The script injects `DATABASE_URL`, `HOST`, and `PORT`
for the API process.

The current hosted API still uses in-memory repositories by default; the local
database is available for auth/persistence wiring as those adapters are added.

Useful variants:

```bash
pnpm dev -- --api-port 3001
pnpm dev -- --postgres-port 54330
pnpm dev -- --skip-podman
pnpm dev -- --db-only
pnpm dev -- --keep-podman
```

`--skip-podman` is useful when you already have a database or only want the
in-memory API routes. `--db-only` starts just the Podman database. The named
Podman volume `sandhost-postgres-data` keeps local database files between runs.

The API can also be started directly:

```bash
pnpm dev:api
```

## Local Podman Smoke Test

Assuming Podman is installed, use the repo-local helper CLI to test the Phase 1
runtime path against the committed node-ts fixture:

```bash
pnpm install
pnpm local:doctor
pnpm local:smoke
```

`pnpm local:doctor` checks the host shape and Podman basics:

```bash
node scripts/sandhost-local.mjs doctor
```

`pnpm local:smoke` does the small end-to-end container test:

1. builds `localhost/sandhost-node-ts:local` from
   `packages/templates/node-ts/Containerfile`;
2. creates a no-network Podman container with CPU and memory limits;
3. copies `packages/runners/fixtures/node-ts-basic` into `/workspace`;
4. runs `/sandhost/runner/run.sh bash -lc "pnpm test"`;
5. copies `/artifacts` back to `.sandhost/local-tests/<runId>`;
6. removes the container.

Useful variants:

```bash
node scripts/sandhost-local.mjs build-node-ts
node scripts/sandhost-local.mjs smoke-node-ts --skip-build
node scripts/sandhost-local.mjs smoke-node-ts --command="node --test test/*.test.js"
```

After a smoke run, inspect the copied artifacts:

```bash
find .sandhost/local-tests -maxdepth 2 -type f | sort
sed -n '1,160p' .sandhost/local-tests/<runId>/logs.txt
sed -n '1,160p' .sandhost/local-tests/<runId>/diff.patch
sed -n '1,160p' .sandhost/local-tests/<runId>/changed-files.txt
```

Expected result: the fixture test passes, `logs.txt` contains the Node test
output, `diff.patch` is empty for the clean fixture, and
`changed-files.txt` is empty.

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

## WSL And Podman Diagnostics

`diagnosePodmanEnvironment` in `packages/runtimes` is the Phase 1 spike for the
future `sandhost doctor` command. It checks WSL detection, `podman --version`,
`podman info --format json`, and whether Podman reports rootless mode.

The diagnostic function accepts an injected command runner so tests can cover
healthy, missing, and rootful Podman cases without depending on the developer's
local machine.

## Todo Workflow

The repository tracks bootstrapping work in `todo.txt`. Complete items in order,
mark each item with `[x]` after implementation, and run the narrowest useful
checks before moving to the next item.
