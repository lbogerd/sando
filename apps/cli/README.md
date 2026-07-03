# Sando CLI

The `@sando/cli` package contains the private `sando` command-line entrypoint
for local setup, diagnostics, policy inspection, and MCP startup.

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
sando help
sando version
sando status
sando doctor
sando init --codex
sando policy defaults
sando mcp
```

Removed prototype command families: direct CLI execution, manual token
save/show/clear, and standalone login.

The MVP demo routes command execution through Codex MCP. Interactive login and
identity setup should happen inside `sando init --codex`, not through manual
local token commands.

## Init

`sando init --codex` starts a hosted login ticket, opens or prints the login
URL, polls for a Better Auth bearer session, creates local project files, and
configures Codex MCP when the Codex CLI is available:

```bash
sando init --codex
```

Created or updated files:

- `.sando/project.json`
- `.sando/policy.json`
- `.sando/session.json`
- `AGENTS.md`

The hosted API registers project, local host, and Codex agent identities before
the MCP config is written.

The command also runs:

```bash
codex mcp add sando -- sando mcp --project-root <project-root>
```

For throwaway validation, set isolated Codex paths before init:

```bash
export HOME=/tmp/sando-demo-home
export CODEX_HOME=/tmp/sando-demo-codex
mkdir -p "$HOME" "$CODEX_HOME"
sando init --codex --project-root /tmp/sando-demo-project
```

Those variables are passed through to `codex mcp add`, so the demo writes to the
temporary Codex config instead of your real one.

## MCP

`sando mcp` starts the stdio MCP server:

```bash
sando mcp
```

The primary execution tool is:

```ts
sando_run_project_command({
	command: "pnpm test",
	network: "none",
	timeoutSeconds: 600,
})
```

## Diagnostics

`sando doctor` prints a small JSON report with the configured API URL, default
network mode, platform, WSL detection status, and Codex MCP config status:

```bash
sando doctor
```

Podman runtime diagnostics live in the repo-local helper:

```bash
pnpm local:doctor
```

## Policies

Inspect default policy values:

```bash
sando policy defaults
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
