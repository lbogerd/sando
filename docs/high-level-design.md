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

Current code implements this flow with Better Auth anonymous sessions plus the
hosted grant scaffolding. The remaining auth milestone is to replace that
scaffolding with the final Agent Auth adapter and interactive hosted login
experience.

Correctness is preferred over compatibility. Removed prototype surfaces should
not remain as aliases or fallback paths.

## Golden Path Status

| Step                                                                                                                         | Status      | Notes                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sando init --codex` creates local project config, policy, AGENTS.md guidance, hosted identity/session, and Codex MCP config | In Progress | Local files, anonymous hosted sign-in, project/host/agent registration, session persistence, and `codex mcp add` wiring exist. Interactive login remains Todo.        |
| Interactive hosted login during init                                                                                         | Todo        | Current init uses Better Auth anonymous sign-in. The target UX should authenticate the developer intentionally.                                                       |
| Project, host, and Codex agent registration during init                                                                      | Done        | Init calls the hosted registration APIs and persists returned IDs in `.sando/project.json`.                                                                           |
| Codex MCP server exposes Sando tools                                                                                         | Done        | The stdio MCP server and tool contracts exist.                                                                                                                        |
| MCP server starts with hosted identity                                                                                       | Done        | The MCP service can load authority from environment variables or persisted `.sando/project.json` and `.sando/session.json`.                                           |
| `sando_run_project_command` is the command execution entrypoint                                                              | In Progress | Tool exists and refuses to run without hosted authorization. Final Agent Auth adapter work remains.                                                                   |
| Hosted grant approval                                                                                                        | In Progress | Current hosted grant scaffolding requests approval, opens the approval URL, polls for a decision, and authorizes grants. It is not yet the final Agent Auth boundary. |
| Local Podman execution                                                                                                       | Done        | Runtime, runner, node-ts template, logs, diff, artifact capture, and local smoke verification exist.                                                                  |
| Local artifact refs for MVP demo                                                                                             | Done        | Local `.sando/runs` outputs and `sando://` refs are sufficient for the demo.                                                                                          |
| Hosted run metadata and audit                                                                                                | In Progress | Run create/finish and command/grant audit events exist. Hosted artifact metadata for returned refs still needs wiring.                                                |
| DB-backed persistence                                                                                                        | Deferred    | Schema exists as target design; repository wiring can wait until after the demo proves the flow.                                                                      |

## Current Component Status

| Component                                     | Status                | Target                                                                                                                                                                                     |
| --------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/cli`                                    | In Progress           | Keep `help`, `version`, `status`, `doctor`, `init --codex`, `policy defaults`, and `mcp`. Init now performs anonymous hosted sign-in and registration; add the final interactive login UX. |
| CLI direct execution                          | Removed               | No direct CLI fallback for the MVP demo. Commands should enter through MCP.                                                                                                                |
| Manual CLI auth commands and standalone login | Removed               | Auth should be part of `sando init --codex`, not a standalone token workflow.                                                                                                              |
| `apps/mcp`                                    | In Progress           | Keep MCP tools. The service can load hosted authority from env or project config and routes command execution through the runner.                                                          |
| `packages/runners`                            | In Progress           | Local Podman orchestration, authority checks, hosted grants, run lifecycle, audit refs, and artifact capture exist. Final Agent Auth semantics and hosted artifact metadata remain.        |
| `packages/runtimes`                           | Done for Podman       | Docker and Kubernetes remain schema values, not implemented runtime paths.                                                                                                                 |
| `packages/templates`                          | Done for `node-ts`    | Keep one node-ts runtime template. Browser/Playwright support is deferred.                                                                                                                 |
| `apps/api`                                    | In Progress           | Keep Hono API, Better Auth mount, registration/grant/run/audit/artifact routes, and in-memory repositories. Add the real Agent Auth adapter and artifact metadata wiring.                  |
| `packages/auth`                               | In Progress           | Better Auth scaffolding exists. Agent Auth adapter is Todo.                                                                                                                                |
| `packages/db`                                 | Done as target schema | Keep schema definitions. DB-backed repositories are deferred for the MVP demo.                                                                                                             |
| Hosted dashboard app                          | Removed               | No dashboard or separate web app in the MVP demo. Approval/login can live in hosted API routes for now.                                                                                    |

## Auth And Authorization

The MVP demo must require hosted authorization for agent-initiated command
execution. Manual token saving is not part of the supported flow.

Current useful scaffolding:

- Better Auth package and hosted auth route mount.
- Agent configuration discovery metadata.
- Anonymous init sign-in with bearer session support.
- Project, host, and agent registration from `sando init --codex`.
- Persisted project identity and session files consumed by the MCP server.
- Grant request, browser approval, polling, authorization, and audit vocabulary.
- Hosted routes and in-memory repositories that model grants, runs, artifacts,
  and audit events.

Required next behavior:

- `sando init --codex` should use the intended interactive hosted login UX
  instead of anonymous sign-in.
- The final Better Auth Agent Auth adapter should become the supported auth
  boundary.
- Custom grant scaffolding should be removed or demoted once the Agent Auth
  adapter covers the same behavior.
- Hosted artifact metadata should be recorded for returned local refs.
- The fresh-project flow should be validated end to end from init through Codex
  MCP approval and execution.

The custom grant flow may remain as internal domain scaffolding while real Agent
Auth is added. It should not be documented as the MVP auth boundary.

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

The remaining hosted metadata gap is artifact metadata for local refs. DB
durability can follow after this flow works end to end.

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
