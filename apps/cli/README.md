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

`sando init --codex` currently creates local project files and configures Codex
MCP when the Codex CLI is available:

```bash
sando init --codex
```

Created or updated files:

- `.sando/project.json`
- `.sando/policy.json`
- `AGENTS.md`

The command also runs:

```bash
codex mcp add sando -- npx -y @sando/cli mcp
```

Interactive hosted login and project/host/agent registration are Todo.

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
