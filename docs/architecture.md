# Architecture

Sando is a pnpm monorepo for the sandhost MVP. The system lets Codex request a
policy-bound project command run through a local sandbox runner instead of
executing directly in the user's working tree.

The full product design is in [high-level-design.md](./high-level-design.md).
This document is the shorter engineering map for the current codebase.

## Runtime Shape

The MVP has three main execution zones:

1. Codex calls the local MCP server.
2. The local runner packages the project, asks the hosted control plane for
   authority, runs Podman, captures logs/artifacts/diffs, and uploads private
   artifact payloads.
3. The hosted control plane owns users, projects, hosts, agents, grants, run
   metadata, artifact metadata, and audit events.

The local runner never writes sandbox changes back to the local repository
automatically. Results are returned as refs, artifacts, and patches for explicit
inspection.

## Packages

- `apps/cli`: future `sandhost` command-line entrypoint for init, login,
  doctor, local MCP startup, and direct run fallback.
- `apps/mcp`: future Codex-facing MCP server exposing
  `sandhost_run_project_command` and supporting read tools.
- `apps/api`: future hosted control-plane API.
- `apps/web`: future hosted approval and metadata UI.
- `packages/shared`: cross-boundary contracts. It owns branded IDs,
  `Result`/error helpers, policy schema helpers, and run-command schemas.
- `packages/runtimes`: sandbox runtime adapter contract. Podman is the MVP
  implementation target, with Docker and Kubernetes left as future adapter
  kinds.
- `packages/runners`: future orchestration layer for policy loading, grant
  checks, workspace archiving, runtime calls, artifact upload, and reporting.
- `packages/templates`: future runtime templates, starting with `node-ts`.
- `packages/auth`: future Better Auth / Agent Auth integration.
- `packages/db`: future hosted metadata persistence.

## Shared Contracts

Shared types should stay small because they are imported across apps, runner
code, runtime adapters, and hosted code. Runtime validation schemas in this
package use Zod, and exported TypeScript contract types should be generated from
those schemas with `z.infer<>`.

Current shared contracts include:

- branded ID aliases for user, project, policy, host, agent, grant, run,
  artifact, and audit event IDs;
- `Result<Value, ErrorValue>`, `ok`, and `err`;
- `SandoError` with stable error codes and JSON-safe details;
- MVP project policy Zod schema, generated type, metadata, defaults, parser,
  and type guard;
- `RunProjectCommandInput` and `RunProjectCommandResult` Zod schemas,
  generated types, parser helpers, and type guards.

Prefer extending these contracts before inventing local equivalents in an app or
package.

## Runtime Boundary

`SandboxRuntime` is the adapter contract for sandbox backends:

1. create a sandbox;
2. upload a workspace archive;
3. run a command;
4. collect artifacts;
5. destroy the sandbox.

Runtime implementations should return `Result` values rather than throwing for
expected operational failures. Unexpected process-level failures can still throw
and should be caught at the runner boundary.

## Policy Boundary

Policy is enforced by combining system limits, hosted project policy, local
project policy, template defaults, grant constraints, and requested command
options. The most restrictive effective value should win.

The MVP policy supports only:

- runtime: `podman`;
- network: `none` or `default`;
- no secrets;
- no automatic writeback;
- bounded CPU, memory, TTL, and command timeout;
- configured artifact and exclusion globs.

## Result Boundary

The high-level MCP flow should prefer one tool:

```ts
sandhost_run_project_command({
	command: "pnpm test",
	network: "none",
	timeoutSeconds: 600,
})
```

The result returns stable refs such as `sandhost://runs/run_123/logs`,
`sandhost://runs/run_123/diff`, and `sandhost://artifacts/art_123`. Consumers
should call read/download tools for payloads instead of assuming local paths.
