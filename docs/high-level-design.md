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
2. Sando performs interactive hosted login and registers the project, local
   host, and Codex agent.
3. Sando configures Codex MCP with enough identity for the local MCP server.
4. Codex calls `sando_run_project_command`.
5. Sando requires real Agent Auth approval.
6. Sando runs the command through local Podman isolation.
7. Sando returns local artifact refs plus hosted run metadata and audit events.

Correctness is preferred over compatibility. Removed prototype surfaces should
not remain as aliases or fallback paths.

## Golden Path Status

| Step                                                                                                | Status      | Notes                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `sando init --codex` creates local project config, policy, AGENTS.md guidance, and Codex MCP config | In Progress | File creation and `codex mcp add` wiring exist. Interactive login and hosted registration are Todo.                      |
| Interactive hosted login during init                                                                | Todo        | Replaces manual local token storage.                                                                                     |
| Project, host, and Codex agent registration during init                                             | Todo        | Registration APIs and schemas exist, but init does not call them yet.                                                    |
| Codex MCP server exposes Sando tools                                                                | Done        | The stdio MCP server and tool contracts exist.                                                                           |
| `sando_run_project_command` is the command execution entrypoint                                     | In Progress | Tool exists and can run locally. It still needs real Agent Auth enforcement as the required path.                        |
| Real Agent Auth approval                                                                            | Todo        | Current grant scaffolding is useful domain work, but is not the final auth boundary.                                     |
| Local Podman execution                                                                              | Done        | Runtime, runner, node-ts template, logs, diff, artifact capture, and local smoke verification exist.                     |
| Local artifact refs for MVP demo                                                                    | Done        | Local `.sando/runs` outputs and `sando://` refs are sufficient for the demo.                                             |
| Hosted run metadata and audit                                                                       | Todo        | Required for the demo, but DB-backed durability is not required initially. In-memory hosted repositories are acceptable. |
| DB-backed persistence                                                                               | Deferred    | Schema exists as target design; repository wiring can wait until after the demo proves the flow.                         |

## Current Component Status

| Component                                     | Status                   | Target                                                                                                                                                 |
| --------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/cli`                                    | In Progress              | Keep `help`, `version`, `status`, `doctor`, `init --codex`, `policy defaults`, and `mcp`. Add interactive init login and registration.                 |
| CLI direct execution                          | Removed                  | No direct CLI fallback for the MVP demo. Commands should enter through MCP.                                                                            |
| Manual CLI auth commands and standalone login | Removed                  | Auth should be part of `sando init --codex`, not a standalone token workflow.                                                                          |
| `apps/mcp`                                    | In Progress              | Keep MCP tools. Require Agent Auth and hosted run/audit metadata before command execution is considered demo-ready.                                    |
| `packages/runners`                            | Done for local execution | Keep local Podman orchestration and artifact capture. Wire hosted authority, run lifecycle, and audit as required behavior.                            |
| `packages/runtimes`                           | Done for Podman          | Docker and Kubernetes remain schema values, not implemented runtime paths.                                                                             |
| `packages/templates`                          | Done for `node-ts`       | Keep one node-ts runtime template. Browser/Playwright support is deferred.                                                                             |
| `apps/api`                                    | In Progress              | Keep Hono API, Better Auth mount, registration/run/audit/artifact routes, and in-memory repositories. Add real Agent Auth and required run/audit flow. |
| `packages/auth`                               | In Progress              | Better Auth scaffolding exists. Agent Auth adapter is Todo.                                                                                            |
| `packages/db`                                 | Done as target schema    | Keep schema definitions. DB-backed repositories are deferred for the MVP demo.                                                                         |
| Hosted dashboard app                          | Removed                  | No dashboard or separate web app in the MVP demo. Approval/login can live in hosted API routes for now.                                                |

## Auth And Authorization

The MVP demo must require Agent Auth for agent-initiated command execution.
Manual token saving is not part of the supported flow.

Current useful scaffolding:

- Better Auth package and hosted auth route mount.
- Agent configuration discovery metadata.
- Grant request, approval, authorization shapes, and audit vocabulary.
- Hosted routes and in-memory repositories that model grants and run metadata.

Required next behavior:

- `sando init --codex` starts hosted login.
- Init registers a project, host, and Codex agent identity.
- The MCP server starts with the registered identity.
- `sando_run_project_command` cannot execute without a valid Agent Auth grant.
- Approval decisions are recorded as hosted audit events.

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

Hosted run metadata and audit are required for the MVP demo even when stored in
memory. The demo should show that the hosted control plane receives the command
lifecycle, not merely that a local process ran.

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
4. The command requires Agent Auth approval.
5. Approved commands run in the local Podman runtime.
6. Denied, expired, or mismatched grants prevent execution.
7. The MCP result includes logs, diff, changed files, local artifact refs, and a
   hosted audit ref.
8. Hosted run metadata and audit events can be inspected for the run lifecycle.
9. No removed prototype command is required to demonstrate the flow.
