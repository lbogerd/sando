# sandhost CLI

The `@sando/cli` package contains the `sandhost` command-line entrypoint for
local setup, diagnostics, auth session storage, policy inspection, and direct
run-request validation.

This package is still private inside the monorepo. During development, run it
from the repository root:

```bash
pnpm --filter @sando/cli exec tsx src/index.ts help
```

If WSL points `TMPDIR` at a Windows-mounted path, use a Linux temp directory:

```bash
TMPDIR=/tmp pnpm --filter @sando/cli exec tsx src/index.ts help
```

## Commands

```bash
sandhost help
sandhost version
sandhost status
sandhost doctor
sandhost auth save --token <token> [--api-url https://api.example] [--user-id user_123]
sandhost auth show
sandhost auth clear
sandhost policy defaults
sandhost run --command "pnpm test" [--network none|default] [--template node-ts] [--timeout 600]
```

`sandhost run` currently validates and normalizes the requested command, network,
template, and timeout. It does not execute a Podman sandbox yet; that execution
path belongs to the runner/MCP integration.

## Auth Sessions

The CLI stores a local auth session in `.sandhost/.env` by default. Override the
path with `--session-file` or `SANDHOST_SESSION_FILE`.

### Getting An Auth Token

For the current local in-memory API, any non-empty token is enough for CLI
session storage demos because the hosted API auth resolver is not wired to
Better Auth sessions yet:

```bash
export SANDHOST_SESSION_TOKEN="dev-token"
export SANDHOST_API_URL="http://localhost:3000"
```

Once the hosted API is started with Better Auth and a database-backed auth
adapter, create an email/password account and copy the returned `token`:

```bash
export SANDHOST_API_URL="http://localhost:3000"

export SANDHOST_SESSION_TOKEN="$(
  curl -sS "$SANDHOST_API_URL/api/auth/sign-up/email" \
    -H "content-type: application/json" \
    -d '{"name":"Local Dev","email":"dev@example.test","password":"password123"}' \
    | jq -r '.token'
)"
```

For an existing account, sign in instead:

```bash
export SANDHOST_SESSION_TOKEN="$(
  curl -sS "$SANDHOST_API_URL/api/auth/sign-in/email" \
    -H "content-type: application/json" \
    -d '{"email":"dev@example.test","password":"password123"}' \
    | jq -r '.token'
)"
```

Both routes also set Better Auth session cookies; the CLI stores the JSON
`token` value in `.sandhost/.env`.

Save a session:

```bash
sandhost auth save --token "$SANDHOST_SESSION_TOKEN" --api-url http://localhost:3000
```

Show session metadata without printing the token:

```bash
sandhost auth show
```

Clear the session:

```bash
sandhost auth clear
```

`sandhost login` is an alias for `sandhost auth save`. It reads
`SANDHOST_SESSION_TOKEN` and `SANDHOST_API_URL` when flags are omitted:

```bash
SANDHOST_SESSION_TOKEN=dev-token SANDHOST_API_URL=http://localhost:3000 sandhost login
```

## Diagnostics

`sandhost doctor` prints a small JSON report with the configured API URL, session
file path, default network mode, platform, and WSL detection status:

```bash
sandhost doctor
```

The report is intentionally lightweight. Podman runtime diagnostics currently
live in the repo-local helper:

```bash
pnpm local:doctor
```

## Policies And Runs

Inspect default policy values:

```bash
sandhost policy defaults
```

Validate a run request:

```bash
sandhost run --command "pnpm test"
sandhost run pnpm test --network=default --timeout=120
```

Defaults are:

- `template`: `node-ts`
- `network`: `none`
- `timeout`: `600` seconds

Supported network modes are `none` and `default`.

## Development

Run package checks from the repository root:

```bash
pnpm --filter @sando/cli typecheck
pnpm test -- apps/cli/src/index.test.ts
```

Build the package:

```bash
pnpm --filter @sando/cli build
```
