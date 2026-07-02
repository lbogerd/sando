# Architecture

Sando is a pnpm monorepo for the Sando MVP demo. The system lets Codex request
a policy-bound project command through MCP, requires scoped user approval, runs
the command through a local sandbox runner, and returns refs for logs, diffs,
artifacts, and audit.

The target design with implementation status lives in
[high-level-design.md](./high-level-design.md). This document is the shorter
engineering map for the current codebase.

## Runtime Shape

The MVP demo has three execution zones:

1. Codex calls the local Sando MCP server.
2. The local runner packages the project, obtains hosted authorization, runs
   Podman, and captures local logs, artifacts, and diffs.
3. The hosted control plane owns login, project/host/agent identity, grants,
   run metadata, artifact metadata, and audit events.

The local runner never writes sandbox changes back to the local repository
automatically. Results are returned as refs and patches for explicit
inspection.

## Packages

- `apps/cli`: `sando` command-line entrypoint for init, diagnostics, policy
  inspection, and local MCP startup. Direct run and manual auth commands are
  intentionally removed.
- `apps/mcp`: Codex-facing MCP server exposing `sando_run_project_command` and
  supporting read tools.
- `apps/api`: hosted control-plane API. It currently uses in-memory repositories
  by default and exposes the route shapes needed for the MVP demo.
- `packages/shared`: cross-boundary contracts. It owns branded IDs,
  `Result`/error helpers, policy schema helpers, Agent Auth/grant shapes, run
  metadata, artifact metadata, audit metadata, and run-command schemas.
- `packages/runtimes`: sandbox runtime adapter contract and Podman
  implementation path.
- `packages/runners`: orchestration layer for policy loading, workspace
  archiving, runtime calls, local artifact capture, and reporting.
- `packages/templates`: runtime templates, currently `node-ts`.
- `packages/auth`: Better Auth configuration for hosted email/password, bearer,
  and legacy anonymous sessions.
- `packages/db`: target hosted metadata schema. DB-backed repositories are
  deferred for the MVP demo.

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
- Sando policy schema, generated type, metadata, defaults, parser, and type
  guard;
- Agent capability, grant, registration, run metadata, artifact metadata, and
  audit metadata schemas;
- `RunProjectCommandInput` and `RunProjectCommandResult` schemas, generated
  types, parser helpers, and type guards.

Prefer extending these contracts before inventing local equivalents in an app
or package.

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

The MVP demo policy supports:

- runtime: `podman`;
- network: `none` or `default`;
- no secrets;
- no automatic writeback;
- bounded CPU, memory, TTL, and command timeout;
- configured artifact and exclusion globs.

## Result Boundary

The high-level MCP flow should prefer one command-execution tool:

```ts
sando_run_project_command({
	command: "pnpm test",
	network: "none",
	timeoutSeconds: 600,
})
```

The result returns stable refs such as `sando://runs/run_123/logs`,
`sando://runs/run_123/diff`, and `sando://artifacts/art_123`. Consumers should
call read/download tools for payloads instead of assuming local paths.
