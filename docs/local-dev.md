# Local Development

## Prerequisites

- Node.js compatible with the installed pnpm toolchain.
- pnpm `10.30.3`, as declared in the root `package.json`.
- Linux or WSL for the local Podman runtime path.

Most repository checks do not require Podman. Runtime tests use injectable
command runners, and the local diagnostics helper reports Podman health without
requiring the whole test suite to shell out to a real Podman install.

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

## Current CLI Surface

The supported CLI commands are intentionally small:

```bash
sando help
sando version
sando status
sando doctor
sando init --codex
sando policy defaults
sando mcp
```

The direct-run and manual-auth command families were removed. The MVP demo
should route command execution through Codex MCP and should perform
login/identity setup inside `sando init --codex`.

During development, run the private CLI from the repository root:

```bash
pnpm --filter @sando/cli exec tsx src/index.ts help
```

If WSL points `TMPDIR` at a Windows-mounted path, use a Linux temp directory:

```bash
TMPDIR=/tmp pnpm --filter @sando/cli exec tsx src/index.ts help
```

## Init And MCP

Build the private workspace CLI and register the MCP server from the built dist
file when you want to test Codex MCP wiring manually:

```bash
pnpm --filter @sando/cli build
codex mcp add sando -- node /home/wub/src/_experiments/sando/apps/cli/dist/index.mjs mcp
```

Restart Codex after changing MCP config. A session that was already open will
not automatically gain the new `sando_run_project_command` tool.

The current `sando init --codex` implementation creates:

- `.sando/project.json`;
- `.sando/policy.json`;
- an AGENTS.md Sando section;
- `.sando/session.json` after the hosted login ticket completes;
- hosted project, host, and Codex agent identity records;
- a Codex MCP config entry when `codex mcp add` is available.

The CLI opens the hosted login URL when possible and prints the URL as a
fallback before polling for the Better Auth bearer session.

For throwaway validation, isolate Codex config from your real account and MCP
registry:

```bash
export HOME=/tmp/sando-demo-home
export CODEX_HOME=/tmp/sando-demo-codex
export SANDO_API_URL=http://127.0.0.1:3307
export TMPDIR=/tmp
mkdir -p "$HOME" "$CODEX_HOME"
sando init --codex --project-root /tmp/sando-demo-project
```

`sando init --codex` passes the active environment through to `codex mcp add`,
so `HOME` and `CODEX_HOME` are preserved when the MCP entry is written.

## Local Hosted API

Use the root dev script to start the hosted API with a local Postgres database:

```bash
pnpm dev
```

By default this starts a Podman Postgres container named `sando-postgres`, waits
for it to become ready, then starts the Hono API at `http://127.0.0.1:3000`.
The script injects `DATABASE_URL`, `HOST`, and `PORT` for the API process.

For local development, `pnpm dev` also injects:

```bash
SANDO_DEV_AUTH_TOKEN=sando-dev-token
SANDO_DEV_USER_ID=user_dev
```

When Better Auth is configured through `DATABASE_URL`, authenticated API calls
should use the bearer session returned by hosted login. The dev token resolver is
only used when the API is started without a Better Auth instance.

The hosted API still uses in-memory repositories by default. The local database
is available for auth and persistence wiring once those adapters are added.

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
Podman volume `sando-postgres-data` keeps local database files between runs.

The API can also be started directly:

```bash
pnpm dev:api
```

## Local Podman Smoke Test

Assuming Podman is installed, use the repo-local helper CLI to test the runtime
path against the committed node-ts fixture:

```bash
pnpm local:doctor
pnpm local:smoke
```

`pnpm local:doctor` checks the host shape and Podman basics:

```bash
node scripts/sando-local.mjs doctor
```

`pnpm local:smoke` does the small end-to-end container test:

1. builds `localhost/sando-node-ts:local` from
   `packages/templates/node-ts/Containerfile`;
2. creates a no-network Podman container with CPU and memory limits;
3. copies `packages/runners/fixtures/node-ts-basic` into `/workspace`;
4. runs `/sando/runner/run.sh bash -lc "pnpm test"`;
5. copies `/artifacts` back to `.sando/local-tests/<runId>`;
6. removes the container.

Useful variants:

```bash
node scripts/sando-local.mjs build-node-ts
node scripts/sando-local.mjs smoke-node-ts --skip-build
node scripts/sando-local.mjs smoke-node-ts --command="node --test test/*.test.js"
```

After a smoke run, inspect the copied artifacts:

```bash
find .sando/local-tests -maxdepth 2 -type f | sort
sed -n '1,160p' .sando/local-tests/<runId>/logs.txt
sed -n '1,160p' .sando/local-tests/<runId>/diff.patch
sed -n '1,160p' .sando/local-tests/<runId>/changed-files.txt
```

Expected result: the fixture test passes, `logs.txt` contains the Node test
output, `diff.patch` is empty for the clean fixture, and `changed-files.txt` is
empty.

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
