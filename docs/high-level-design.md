# Sando MVP Demo High-Level Design

## Status Legend

- Done: implemented enough to rely on in the current repo.
- In Progress: partially implemented, but not yet the target behavior.
- Todo: planned and required for the MVP demo.
- Deferred: intentionally outside the MVP demo.
- Removed: intentionally cut from the current project surface.

## Product Anchor

Sando is a secure execution layer for Codex. It lets an agent request a project
command through MCP, requires scoped user approval through Agent Auth, executes
the command in a local sandbox, and returns logs, diffs, artifact refs, hosted
run metadata, and audit events.

The current target is an honest **MVP demo**, not a complete hosted product. The
demo should prove the low-friction in-agent flow:

1. A developer runs `sando init --codex`.
2. Sando performs hosted login and registers the project, local host, and Codex
   agent.
3. Sando configures Codex MCP with enough identity for the local MCP server.
4. Codex calls `sando_run_project_command`.
5. Sando requires hosted authorization before execution.
6. Sando runs the command through local Podman isolation.
7. Sando returns local artifact refs plus hosted run metadata and audit events.

Current code implements this flow with an interactive hosted login ticket, Better
Auth email/password and bearer sessions, and a Sando-owned Better Auth Agent
Authority over the internal grant domain.

Correctness is preferred over compatibility. Removed prototype surfaces should
not remain as aliases or fallback paths.

## Golden Path Status

| Step                                                                                                                         | Status   | Notes                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sando init --codex` creates local project config, policy, AGENTS.md guidance, hosted identity/session, and Codex MCP config | Done     | Init starts a hosted login ticket, opens or prints the login URL, polls for a Better Auth bearer session, registers project/host/agent identities, and configures MCP. |
| Interactive hosted login during init                                                                                         | Done     | Hosted API login routes complete the ticket through Better Auth email/password sign in or account creation.                                                            |
| Project, host, and Codex agent registration during init                                                                      | Done     | Init calls the hosted registration APIs and persists returned IDs in `.sando/project.json`.                                                                            |
| Codex MCP server exposes Sando tools                                                                                         | Done     | The stdio MCP server and tool contracts exist.                                                                                                                         |
| MCP server starts with hosted identity                                                                                       | Done     | The MCP service can load authority from environment variables or persisted `.sando/project.json` and `.sando/session.json`.                                            |
| `sando_run_project_command` is the command execution entrypoint                                                              | Done     | Tool exists, refuses to run without hosted authorization, and uses Better Auth Agent Authority for execution approval.                                                 |
| Hosted grant approval                                                                                                        | Done     | Better Auth Agent Authority requests approval, opens the approval URL, polls for a decision, and authorizes execution against the internal grant domain.               |
| Local Podman execution                                                                                                       | Done     | Runtime, runner, node-ts template, logs, diff, artifact capture, and local smoke verification exist.                                                                   |
| Local artifact refs for MVP demo                                                                                             | Done     | Local `.sando/runs` outputs and `sando://` refs are sufficient for the demo.                                                                                           |
| Hosted run metadata and audit                                                                                                | Done     | Run create/finish, command/grant audit events, and hosted artifact metadata registration for returned local refs are wired.                                            |
| DB-backed persistence                                                                                                        | Deferred | Schema exists as target design; repository wiring can wait until after the demo proves the flow.                                                                       |

## Current Component Status

| Component                                     | Status                | Target                                                                                                                                                                               |
| --------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/cli`                                    | Done for MVP          | Keep `help`, `version`, `status`, `doctor`, `init --codex`, `policy defaults`, and `mcp`. Init performs interactive hosted login, registration, session persistence, and MCP config. |
| CLI direct execution                          | Removed               | No direct CLI fallback for the MVP demo. Commands should enter through MCP.                                                                                                          |
| Manual CLI auth commands and standalone login | Removed               | Auth should be part of `sando init --codex`, not a standalone token workflow.                                                                                                        |
| `apps/mcp`                                    | Done for MVP          | Keep MCP tools. The service can load Better Auth Agent Authority from env or project config and routes command execution through the runner.                                         |
| `packages/runners`                            | Done for MVP          | Local Podman orchestration, Better Auth Agent Authority checks, hosted run lifecycle, audit refs, artifact capture, and hosted artifact metadata registration are wired.             |
| `packages/runtimes`                           | Done for Podman       | Docker and Kubernetes remain schema values, not implemented runtime paths.                                                                                                           |
| `packages/templates`                          | Done for `node-ts`    | Keep one node-ts runtime template. Browser/Playwright support is deferred.                                                                                                           |
| `apps/api`                                    | Done for MVP          | Keep Hono API, Better Auth mount, login ticket, registration, internal grant, run, audit, artifact routes, and in-memory repositories.                                               |
| `packages/auth`                               | Done for MVP          | Better Auth email/password, bearer, and legacy anonymous plugin configuration exists; init uses hosted email login, not anonymous sign-in.                                           |
| `packages/db`                                 | Done as target schema | Keep schema definitions. DB-backed repositories are deferred for the MVP demo.                                                                                                       |
| Hosted dashboard app                          | Removed               | No dashboard or separate web app in the MVP demo. Approval/login can live in hosted API routes for now.                                                                              |

## Auth And Authorization

The MVP demo must require hosted authorization for agent-initiated command
execution. Manual token saving is not part of the supported flow.

Current useful scaffolding:

- Better Auth package and hosted auth route mount.
- Agent configuration discovery metadata.
- Interactive hosted login ticket with Better Auth email/password and bearer
  session support.
- Project, host, and agent registration from `sando init --codex`.
- Persisted project identity and session files consumed by the MCP server.
- Grant request, browser approval, polling, authorization, and audit vocabulary.
- Hosted routes and in-memory repositories that model grants, runs, artifacts,
  and audit events.

Required next behavior:

- The fresh-project flow should be validated end to end from init through Codex
  MCP approval and execution.

The custom grant flow remains as internal domain storage for the Better Auth
Agent Authority. It should not be treated as the public MVP auth boundary.

## Execution And Artifacts

The local runner is responsible for:

- archiving the project without writing sandbox output into the repo;
- applying the effective policy;
- creating a Podman sandbox;
- running the command with configured network and timeout limits;
- capturing stdout, stderr, logs, `diff.patch`, and `changed-files.txt`;
- copying local artifacts into `.sando/runs/<runId>`;
- returning `sando://` refs.

For the MVP demo, artifact payloads can remain local artifact refs. Hosted
private artifact storage is deferred and should be described generically, not
as a specific vendor integration.

Default artifact globs should stay focused on current local outputs:

```json
["coverage/**", "test-results/**", "*.patch"]
```

Browser and Playwright artifacts are deferred.

## Hosted Metadata And Audit

Hosted run metadata and audit are implemented enough for the current demo path
when stored in memory. The demo should show that the hosted control plane
receives the command lifecycle, not merely that a local process ran.

Minimum required hosted records:

- project, host, and agent identities;
- grant request, approval, denial, expiry, and authorization events;
- run creation and completion;
- command started and command finished events;
- artifact metadata for returned local refs when available.

DB durability can follow after this flow works end to end.

## Supported CLI Surface

Current supported commands:

```bash
sando help
sando version
sando status
sando doctor
sando init --codex
sando policy defaults
sando mcp
```

Removed command families: direct CLI execution, manual token save/show/clear,
and standalone login.

## Development Verification

Keep these repo-local verification commands:

```bash
pnpm local:doctor
pnpm local:smoke
```

Removed prototype verification harnesses: the manual approval harness and the
Codex MCP smoke harness. They were useful while exploring, but they now obscure
the real MVP demo path.

## Deferred Work

- DB-backed repositories for hosted metadata.
- Private hosted artifact payload storage.
- Browser and Playwright runtime support.
- Dashboard or hosted web app.
- Direct CLI command execution.
- Docker and Kubernetes runtime implementations.
- GitHub PR/push flows.
- Secret injection and secret policy management.
- Team/project administration UI.

## MVP Demo Acceptance Criteria

The MVP demo is ready when:

1. A fresh project can run `sando init --codex`.
2. Init performs hosted login and registers project, host, and Codex agent
   identity.
3. Codex can discover the Sando MCP server and call
   `sando_run_project_command`.
4. The command requires hosted approval through the supported auth boundary.
5. Approved commands run in the local Podman runtime.
6. Denied, expired, or mismatched grants prevent execution.
7. The MCP result includes logs, diff, changed files, local artifact refs, and a
   hosted audit ref.
8. Hosted run metadata and audit events can be inspected for the run lifecycle.
9. No removed prototype command is required to demonstrate the flow.
