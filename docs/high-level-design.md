# sandhost MVP High-Level Design

## 1. Summary

sandhost is a secure execution layer for coding agents. The MVP allows Codex to run project commands inside local, policy-bound Podman sandboxes instead of directly on the user’s development environment.

The MVP focuses on one complete workflow:

> Codex requests permission to use sandhost, runs a project command in a local Podman sandbox, retrieves logs/artifacts/diffs, and leaves behind an audit trail — all under hosted capability-based authorization.

The MVP intentionally does not attempt to be a full subagent platform yet. It establishes the core primitives needed for the final product vision:

* agent identity,
* scoped grants,
* local sandboxed execution,
* command execution,
* logs,
* artifacts,
* diffs,
* audit events,
* private artifact storage,
* project-level policy.

## 2. Key MVP Decisions

### 2.1 Primary Agent Target

The MVP targets **Codex first**.

Other integrations such as Claude Code, Pi, ACP, and AHP remain future expansion paths.

### 2.2 Execution Location

Execution happens on the **user’s local laptop**, specifically targeting:

```text
Linux via WSL
```

The hosted sandhost service does not directly control the user’s machine. The local runner performs execution and makes outbound requests to the hosted control plane.

### 2.3 Runtime

The MVP uses **Podman**, not Docker.

Podman is the default runtime because it fits the Linux/WSL target, supports rootless-oriented local container execution, and avoids depending on a privileged always-running daemon.

The runtime abstraction should still allow future backends:

```text
PodmanRuntime      MVP
DockerRuntime      optional fallback, not MVP default
KubernetesRuntime  later
```

### 2.4 Control Plane

The control plane is **hosted only**.

The local component is not a control plane. It is a local runner/broker that:

* exposes MCP to Codex,
* builds the project archive,
* runs Podman,
* captures logs/artifacts/diffs,
* uploads artifacts,
* talks to the hosted control plane over HTTPS.

### 2.5 Artifact Storage

Artifacts are stored in **UploadThing**.

For the MVP, UploadThing artifacts are treated as private by default. sandhost stores metadata in its database and should control access through authenticated artifact routes or signed/private access mechanisms.

### 2.6 Approval Model

The authoritative approval model is **sandhost Agent Auth**.

Codex’s native approval UX can provide a useful extra confirmation step, but it is not the security boundary.

The security boundary is:

```text
hosted sandhost control plane
  → Better Auth / Agent Auth
  → active grant
  → capability check
  → project + machine + agent constraints
```

### 2.7 Grant Scope

The MVP supports both:

```text
one-shot grants
time-bound project grants
```

Default approval choices:

```text
Approve once
Approve for 30 minutes
Deny
```

No permanent grants in MVP.

### 2.8 Network Model

The MVP keeps network controls simple and honest.

Supported modes:

```text
none
default
```

`none` means the sandbox has no external network access.

`default` means the sandbox gets normal Podman networking.

The MVP should not claim hostname-level allowlists. Fine-grained network allowlists are deferred until a later runtime/policy phase.

### 2.9 Browser Support

Browsers and Playwright are deferred.

The MVP only ships the `node-ts` command-execution template.

### 2.10 Writeback Model

The sandbox never writes back to the local repo automatically.

sandhost returns:

```text
diff.patch
changed-files.txt
artifacts
logs
result.json
```

The agent or user may inspect/apply the patch later.

## 3. Product Goal

The MVP should prove that sandhost can safely sit between Codex and risky local execution.

A user should be able to say:

```text
Use sandhost to run pnpm test safely.
```

Codex should be able to:

1. call sandhost through MCP,
2. request the required capability grant,
3. receive user approval,
4. package the current project,
5. create a local Podman sandbox,
6. run the requested command,
7. capture logs,
8. capture artifacts,
9. capture a diff,
10. upload artifacts privately,
11. destroy the sandbox,
12. return a useful result.

## 4. MVP North Star

The MVP is successful when Codex can run a real project command through sandhost without the user needing to understand Podman, runtime flags, artifact upload, grants, or sandbox policy.

The expected first demo:

1. User opens a TypeScript repo in WSL.
2. User runs:

```bash
npx sandhost init --codex
```

3. sandhost configures Codex MCP access and project policy.
4. User asks Codex:

```text
Use sandhost to run pnpm test safely.
```

5. Codex calls the sandhost MCP tool.
6. sandhost requests a scoped grant.
7. User approves for the project, agent, and local machine.
8. sandhost runs the command in a local Podman sandbox.
9. sandhost returns logs, exit code, artifacts, and diff.
10. The sandbox is destroyed.
11. The hosted audit trail shows what happened.

## 5. Goals

### 5.1 Product Goals

* Make sandboxed command execution easy from Codex.
* Avoid direct execution of risky commands in the user’s working environment.
* Avoid giving Codex ambient authority over sandhost.
* Replace broad API keys with short-lived scoped capability grants.
* Provide a clear approval moment before execution.
* Capture useful results: logs, exit code, artifacts, and diff.
* Upload artifacts privately.
* Maintain an audit trail.
* Keep setup friction low.

### 5.2 Technical Goals

* Provide a Codex-compatible MCP server.
* Use Better Auth Agent Auth for hosted agent authorization.
* Use local Podman for sandbox execution.
* Use UploadThing for private artifact payloads.
* Store run metadata, artifact metadata, grants, and audit events in the hosted control plane.
* Support a high-quality `node-ts` runtime template.
* Avoid automatic local writeback.
* Keep the runtime interface clean enough to support Kubernetes later.

## 6. Non-Goals

The MVP does not include:

* Kubernetes execution,
* Docker as the default runtime,
* browser/Playwright templates,
* native ACP support,
* AHP shared session hosting,
* autonomous/background agents,
* secret mounting,
* arbitrary hostname-level network allowlists,
* pull request creation,
* git push,
* deployment,
* persistent workspaces,
* sandbox hibernation,
* full dashboard,
* full enterprise admin console,
* template marketplace,
* multi-agent orchestration,
* automatic patch application to the local repo.

## 7. Primary User

### 7.1 Individual Developer Using Codex

The first user is a developer running Codex in a local WSL/Linux development environment who wants Codex to run tests/builds/scripts without directly executing risky commands in the project environment.

## 8. Core Architecture

```text
┌──────────────────────────────────────────────┐
│ Codex                                        │
│----------------------------------------------│
│ User prompt                                  │
│ MCP client                                   │
│ Native tool approval UX where available      │
└──────────────────────────────────────────────┘
        │
        │ MCP
        ▼
┌──────────────────────────────────────────────┐
│ sandhost Local Runner                        │
│----------------------------------------------│
│ MCP server                                   │
│ Codex project context                        │
│ project archive builder                      │
│ local policy loader                          │
│ Podman runtime adapter                       │
│ log collector                                │
│ diff collector                               │
│ artifact collector                           │
│ UploadThing upload client                    │
└──────────────────────────────────────────────┘
        │
        │ HTTPS
        ▼
┌──────────────────────────────────────────────┐
│ Hosted sandhost Control Plane                │
│----------------------------------------------│
│ Better Auth                                  │
│ Agent Auth provider                          │
│ user/project/agent/host records              │
│ capability registry                          │
│ grant store                                  │
│ approval routes                              │
│ run metadata                                 │
│ artifact metadata                            │
│ audit event pipeline                         │
│ UploadThing integration                      │
└──────────────────────────────────────────────┘
        │
        │ signed/private artifact upload
        ▼
┌──────────────────────────────────────────────┐
│ UploadThing                                  │
│----------------------------------------------│
│ logs                                         │
│ stdout/stderr                                │
│ result.json                                  │
│ diff.patch                                   │
│ changed-files.txt                            │
│ configured artifact paths                    │
└──────────────────────────────────────────────┘
```

## 9. Major Components

## 9.1 `@sandhost/cli`

The CLI provides initialization, diagnostics, login, and local runner startup.

MVP commands:

```bash
sandhost init --codex
sandhost login
sandhost doctor
sandhost mcp
sandhost run "pnpm test"
sandhost policy show
```

Responsibilities:

* initialize project config,
* configure Codex MCP,
* create/update local sandhost policy,
* authenticate user with hosted control plane,
* verify Podman availability,
* start MCP server,
* provide a fallback non-agent command path.

## 9.2 `@sandhost/mcp`

The MCP server is the primary Codex integration.

The MVP should optimize for one high-level tool rather than forcing Codex to orchestrate low-level sandbox lifecycle steps.

Primary tool:

```ts
sandhost_run_project_command({
  command: string
  template?: string
  network?: "none" | "default"
  timeoutSeconds?: number
})
```

Supporting tools:

```ts
sandhost_list_templates()
sandhost_explain_policy()
sandhost_get_run({ runId })
sandhost_read_logs({ runId })
sandhost_get_diff({ runId })
sandhost_download_artifact({ artifactId })
```

Advanced tools may exist internally or behind an advanced flag:

```ts
sandhost_create_sandbox()
sandhost_run_command()
sandhost_destroy_sandbox()
```

The happy path should use `sandhost_run_project_command`.

## 9.3 Local Runner

The local runner performs all local execution work.

Responsibilities:

* load `.sandhost/policy.json`,
* detect project root,
* build workspace archive,
* request/verify grant status through hosted control plane,
* create Podman container,
* run command,
* enforce timeout,
* capture stdout/stderr,
* capture diff,
* collect artifacts,
* upload artifact payloads,
* report metadata to hosted control plane,
* clean up container/resources.

The local runner must only make outbound HTTPS requests.

## 9.4 Hosted Control Plane

The hosted control plane owns authority and metadata.

Responsibilities:

* user authentication,
* agent registration,
* local host registration,
* project registration,
* capability registry,
* grant requests,
* approval UI,
* grant validation,
* run metadata,
* artifact metadata,
* audit log,
* UploadThing integration.

## 9.5 Agent Auth Layer

Better Auth Agent Auth provides the protocol-level authorization substrate.

Use it for:

* discovery,
* agent identity,
* agent registration,
* capability listing,
* grant request,
* user approval,
* short-lived JWT issuance,
* replay protection,
* audit hooks.

Do not let Agent Auth become the whole internal domain model.

sandhost should wrap it behind an internal interface:

```ts
interface AgentAuthority {
  getAgentSession(headers: Headers): Promise<AgentSession | null>
  requestGrant(input: GrantRequestInput): Promise<GrantRequest>
  requireCapability(input: RequireCapabilityInput): Promise<AuthorizedCapability>
  listCapabilities(context: CapabilityContext): Promise<Capability[]>
}
```

MVP implementation:

```text
BetterAuthAgentAuthority
```

## 9.6 Podman Runtime Adapter

The Podman runtime adapter is the MVP sandbox backend.

Responsibilities:

* pull runtime image,
* create container,
* copy workspace into container,
* apply CPU/memory limits,
* apply network mode,
* run command,
* stream/capture logs,
* copy artifacts out,
* destroy container.

Example runtime interface:

```ts
interface SandboxRuntime {
  createSandbox(input: CreateSandboxInput): Promise<SandboxHandle>
  uploadWorkspace(handle: SandboxHandle, archive: WorkspaceArchive): Promise<void>
  runCommand(handle: SandboxHandle, command: CommandSpec): Promise<RunResult>
  collectArtifacts(handle: SandboxHandle): Promise<ArtifactBundle>
  destroySandbox(handle: SandboxHandle): Promise<void>
}
```

MVP implementation:

```text
PodmanRuntime
```

Future implementation:

```text
KubernetesRuntime
```

## 10. Codex Integration

`npx sandhost init --codex` should configure Codex to access the local MCP server.

Target outcome:

```text
Codex can call sandhost_run_project_command from the current repo.
```

Generated/updated project files:

```text
.sandhost/project.json
.sandhost/policy.json
AGENTS.md
```

Generated/updated Codex config:

```text
Codex MCP configuration
```

The exact file path and config format should be handled by the CLI based on the local Codex environment.

Suggested AGENTS.md insertion:

```md
## sandhost

Use sandhost for commands that may execute generated, dependency-installing, destructive, or risky code.

Prefer:

- `sandhost_run_project_command` through MCP
- `sandhost run "<command>"` as a CLI fallback

Do not apply sandbox changes to the local repo automatically. Inspect `diff.patch` first.
```

## 11. Capability Model

## 11.1 MVP Capabilities

```text
sandbox.list_templates
sandbox.explain_policy
sandbox.run_project_command
sandbox.read_logs
sandbox.get_diff
sandbox.download_artifact
```

Internally, `sandbox.run_project_command` covers:

```text
workspace.archive
sandbox.create
sandbox.upload_workspace
sandbox.run_command
sandbox.collect_artifacts
sandbox.collect_diff
sandbox.destroy
```

The user should approve the high-level action, not every internal lifecycle step.

## 11.2 Capability Constraints

Capability grants are constrained by:

* user,
* project,
* local machine/host,
* agent,
* template,
* runtime,
* network mode,
* max TTL,
* max CPU,
* max memory,
* command timeout,
* artifact paths,
* excluded paths.

Example grant:

```json
{
  "capabilities": [
    "sandbox.run_project_command",
    "sandbox.read_logs",
    "sandbox.get_diff",
    "sandbox.download_artifact"
  ],
  "constraints": {
    "projectId": "proj_123",
    "hostId": "host_123",
    "agentId": "agent_codex_123",
    "templates": ["node-ts"],
    "runtime": "podman",
    "network": ["none", "default"],
    "maxTtlSeconds": 1800,
    "maxCpu": 2,
    "maxMemoryMb": 4096,
    "maxTimeoutSeconds": 600,
    "secrets": [],
    "artifactPaths": [
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "*.patch"
    ]
  }
}
```

## 11.3 Grant Types

```ts
type GrantScope =
  | { type: "one_shot"; commandHash: string }
  | { type: "project_window"; projectId: string; hostId: string; agentId: string; expiresAt: string }
```

MVP approval buttons:

```text
Approve once
Approve for 30 minutes
Deny
```

No permanent approval in MVP.

## 12. Approval Flow

The MVP approval flow should prioritize clarity over protocol ambition.

Flow:

1. Codex calls `sandhost_run_project_command`.
2. Local runner asks hosted control plane whether an active grant exists.
3. If no grant exists, hosted control plane creates a grant request.
4. User approves in sandhost-hosted approval UI.
5. Control plane issues short-lived capability authority.
6. Local runner executes command.
7. Control plane records audit events.

Approval copy:

```text
Codex wants to run a project command with sandhost.

Project:
acme/web

Machine:
Lucas WSL environment

Requested:
- Package project workspace
- Create local Podman sandbox
- Run command inside sandbox
- Capture logs
- Capture diff
- Upload private artifacts
- Destroy sandbox

Command:
pnpm test

Policy:
- Runtime: Podman
- Template: node-ts
- Network: none/default as requested
- Secrets: none
- Auto-writeback: disabled
- Max CPU: 2
- Max memory: 4 GB
- Max timeout: 10 minutes

Approve once
Approve for 30 minutes
Deny
```

## 13. Policy Model

MVP policy file:

```json
{
  "version": 1,
  "defaultTemplate": "node-ts",
  "runtime": "podman",
  "defaultNetwork": "none",
  "allowedNetworks": ["none", "default"],
  "maxTtlSeconds": 1800,
  "maxTimeoutSeconds": 600,
  "resources": {
    "cpu": 2,
    "memoryMb": 4096
  },
  "secrets": {
    "allow": []
  },
  "artifacts": [
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    "*.patch"
  ],
  "exclude": [
    ".git",
    "node_modules",
    ".env",
    ".env.*",
    "dist",
    "build",
    "coverage",
    ".sandhost/runs"
  ]
}
```

Policy compilation combines:

1. system hard limits,
2. hosted project policy,
3. local project policy,
4. template defaults,
5. grant constraints,
6. requested command options.

The most restrictive effective value should win.

## 14. Workspace Model

The MVP uses archive copy-in/copy-out.

It does not bind-mount the local project directory into the sandbox.

### 14.1 Archive Creation

The local runner builds a project archive from the current repo.

File selection should start with:

```bash
git ls-files -co --exclude-standard
```

Then apply:

* `.sandhost/policy.json` exclusions,
* sensitive-file exclusions,
* generated-output exclusions.

Default exclusions:

```text
.git
node_modules
.env
.env.*
dist
build
coverage
.sandhost/runs
```

### 14.2 Workspace Location

Inside the sandbox:

```text
/workspace
```

Artifacts are written to:

```text
/artifacts
```

The command runs from:

```text
/workspace
```

## 15. Diff Strategy

The MVP should compute diffs by creating a baseline git repository inside the sandbox.

Do not upload `.git`.

Flow inside sandbox:

```bash
cd /workspace

git init
git config user.email "sandhost@example.local"
git config user.name "sandhost"
git add -A
git commit -m "sandhost baseline"

# run user command here

git add -N .
git diff --binary HEAD > /artifacts/diff.patch
git status --porcelain=v1 > /artifacts/changed-files.txt
```

Benefits:

* avoids uploading `.git`,
* avoids leaking remotes/history,
* produces normal patch files,
* captures modifications and deletions,
* captures new files with `git add -N`,
* keeps the diff logic inside the sandbox.

For non-git directories, fallback behavior:

* snapshot file hashes before execution,
* snapshot file hashes after execution,
* emit `changed-files.txt`,
* optionally skip `diff.patch`.

## 16. Runtime Template: `node-ts`

The first template is `node-ts`.

Base requirements:

```text
Node.js LTS
npm
pnpm
git
bash
coreutils
ripgrep
curl
ca-certificates
basic build tools
```

Runtime defaults:

```text
user: non-root
workdir: /workspace
artifact dir: /artifacts
network: none unless requested
memory: 4 GB max
cpu: 2 max
timeout: 10 minutes default
```

Browsers and Playwright are deferred to a later `node-ts-browser` template.

## 17. Podman Execution Model

Example conceptual command:

```bash
podman run \
  --rm \
  --network none \
  --memory 4g \
  --cpus 2 \
  --userns keep-id \
  --name sandhost-run-<id> \
  sandhost-node-ts:<version> \
  /sandhost/runner/run.sh
```

The exact flags should be validated during implementation on WSL.

Execution principles:

* prefer rootless Podman,
* no privileged containers,
* no host project bind mount,
* no automatic host writeback,
* no secrets,
* resource limits required,
* timeout required,
* network disabled by default,
* cleanup required.

## 18. Network Model

Supported MVP network modes:

```text
none
default
```

### 18.1 `none`

Use for commands that should not require internet.

Examples:

```text
pnpm test
npm test
pnpm build
tsc --noEmit
```

### 18.2 `default`

Use when the command needs internet access.

Examples:

```text
pnpm install
npm install
curl-based scripts
dependency downloads
```

Approval UI must clearly state when `default` networking is requested.

MVP does not support true hostname allowlists.

A later phase may add:

```text
package-install-only
egress proxy
hostname allowlists
Kubernetes NetworkPolicy
```

## 19. Artifact Model

The local runner collects artifacts after the command completes.

Default artifacts:

```text
/artifacts/result.json
/artifacts/logs.txt
/artifacts/stdout.txt
/artifacts/stderr.txt
/artifacts/diff.patch
/artifacts/changed-files.txt
```

Configured project artifacts:

```text
coverage/**
test-results/**
playwright-report/**
*.patch
```

The local runner uploads artifact payloads to UploadThing.

The hosted control plane stores artifact metadata:

```ts
type Artifact = {
  id: string
  runId: string
  projectId: string
  name: string
  path: string
  contentType?: string
  sizeBytes?: number
  uploadThingKey: string
  private: true
  createdAt: string
  retentionExpiresAt?: string
}
```

Artifact downloads should go through sandhost authorization, even if UploadThing provides the underlying storage.

## 20. Run Result

MCP result shape:

```ts
type RunProjectCommandResult = {
  runId: string
  status: "succeeded" | "failed" | "cancelled" | "timed_out"
  exitCode: number | null
  durationMs: number
  command: string
  network: "none" | "default"
  summary: string
  logsRef: string
  stdoutRef: string
  stderrRef: string
  diffRef?: string
  changedFilesRef?: string
  artifacts: ArtifactRef[]
  auditRef: string
}
```

Example response to Codex:

```json
{
  "runId": "run_123",
  "status": "failed",
  "exitCode": 1,
  "durationMs": 42100,
  "command": "pnpm test",
  "network": "none",
  "summary": "The test suite failed in src/auth/session.test.ts.",
  "logsRef": "sandhost://runs/run_123/logs",
  "diffRef": "sandhost://runs/run_123/diff",
  "artifacts": [
    {
      "name": "changed-files.txt",
      "uri": "sandhost://artifacts/art_123"
    }
  ],
  "auditRef": "sandhost://runs/run_123/audit"
}
```

## 21. Audit Model

MVP audit events:

```text
agent.registered
host.registered
project.initialized
grant.requested
grant.approved
grant.denied
capability.executed
run.created
workspace.archived
sandbox.created
command.started
command.finished
artifact.uploaded
diff.created
sandbox.destroyed
grant.expired
```

Audit event shape:

```ts
type AuditEvent = {
  id: string
  type: string
  userId: string
  projectId?: string
  hostId?: string
  agentId?: string
  grantId?: string
  runId?: string
  timestamp: string
  metadata: Record<string, unknown>
}
```

## 22. Security Model

### 22.1 MVP Security Principles

* Local execution only.
* Rootless Podman preferred.
* No host project bind mount.
* No automatic local writeback.
* No secrets.
* No privileged containers.
* No permanent grants.
* Network disabled by default.
* Resource limits required.
* Timeout required.
* Private artifact storage.
* All meaningful actions audited.
* Hosted control plane authorizes capability use.
* Grants are scoped to user + project + local host + agent.

### 22.2 Threats Reduced

The MVP reduces risk from:

* Codex accidentally modifying local files,
* generated scripts running directly in the dev environment,
* dependency scripts executing locally,
* runaway commands,
* untracked agent behavior,
* accidental `.env` upload,
* broad long-lived API key usage,
* automatic patch application.

### 22.3 Threats Not Fully Solved

The MVP does not fully solve:

* malicious dependency behavior when network is enabled,
* all container escape classes,
* kernel-level sandbox hardening,
* fine-grained egress control,
* secret misuse,
* browser automation risk,
* supply-chain compromise,
* side-channel attacks,
* malware-analysis-grade isolation.

The product should be explicit that the MVP provides local sandboxed execution, not a hardened untrusted-code microVM boundary.

## 23. Data Model

### 23.1 Project

```ts
type Project = {
  id: string
  userId: string
  name: string
  localFingerprint: string
  policyId: string
  createdAt: string
}
```

### 23.2 Host

```ts
type Host = {
  id: string
  userId: string
  name: string
  platform: "linux-wsl"
  runtime: "podman"
  fingerprint: string
  createdAt: string
  lastSeenAt: string
}
```

### 23.3 Agent

```ts
type Agent = {
  id: string
  userId: string
  hostId: string
  kind: "codex"
  displayName: string
  createdAt: string
  lastSeenAt: string
}
```

### 23.4 Grant

```ts
type Grant = {
  id: string
  userId: string
  projectId: string
  hostId: string
  agentId: string
  capabilities: string[]
  constraints: Record<string, unknown>
  scope: "one_shot" | "project_window"
  status: "pending" | "approved" | "denied" | "expired" | "revoked"
  expiresAt?: string
  createdAt: string
  approvedAt?: string
}
```

### 23.5 Run

```ts
type Run = {
  id: string
  userId: string
  projectId: string
  hostId: string
  agentId: string
  grantId: string
  command: string
  template: string
  runtime: "podman"
  network: "none" | "default"
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out"
  exitCode?: number
  startedAt?: string
  finishedAt?: string
  durationMs?: number
}
```

### 23.6 Artifact

```ts
type Artifact = {
  id: string
  runId: string
  projectId: string
  name: string
  path: string
  contentType?: string
  sizeBytes?: number
  uploadThingKey: string
  private: true
  createdAt: string
}
```

## 24. Implementation Phases

### Phase 0: Project Skeleton

* Monorepo/package structure.
* Hosted server skeleton.
* CLI skeleton.
* MCP server skeleton.
* Podman runtime spike.
* UploadThing integration spike.

### Phase 1: Local Podman Run Without Agent Auth

Goal:

```bash
sandhost run "pnpm test"
```

Must support:

* project archive,
* Podman container execution,
* no-network/default-network mode,
* stdout/stderr capture,
* exit code,
* diff generation,
* artifact collection,
* cleanup.

### Phase 2: Hosted Metadata and UploadThing

Add:

* hosted project records,
* hosted run records,
* private artifact upload,
* artifact metadata,
* audit metadata.

### Phase 3: Codex MCP Integration

Add:

* `sandhost init --codex`,
* Codex MCP config generation,
* `sandhost_run_project_command`,
* inspection tools,
* AGENTS.md insertion.

### Phase 4: Agent Auth Grants

Add:

* Agent Auth provider,
* capability registry,
* agent/host registration,
* grant request,
* approval UI,
* one-shot grant,
* 30-minute project-window grant,
* short-lived execution authority,
* audit hooks.

### Phase 5: MVP Polish

Add:

* `sandhost doctor`,
* stronger error messages,
* WSL-specific diagnostics,
* Podman installation guidance,
* run summary formatting,
* artifact download authorization,
* docs,
* first demo flow.

## 25. MVP Acceptance Criteria

The MVP is complete when:

1. A user on Linux via WSL can run `npx sandhost init --codex`.
2. sandhost detects or validates Podman.
3. Codex can call the sandhost MCP server.
4. Codex can invoke `sandhost_run_project_command`.
5. The first run triggers a hosted sandhost approval flow.
6. Approval is scoped to user, project, host, and Codex agent identity.
7. The local runner archives the project without `.git`, `node_modules`, or `.env`.
8. The command runs inside a local Podman sandbox.
9. Network mode is explicit: `none` or `default`.
10. The sandbox does not bind-mount or automatically modify the local repo.
11. sandhost captures stdout, stderr, exit code, duration, logs, diff, and changed files.
12. Artifacts are uploaded privately through UploadThing.
13. Run metadata and audit events are stored in the hosted control plane.
14. The sandbox is cleaned up after execution.
15. Codex receives a concise result it can use to continue the coding task.

## 26. Deferred Features

Deferred until after MVP:

* Kubernetes backend,
* Docker fallback,
* Claude Code integration,
* Pi integration,
* ACP,
* AHP,
* subagent sessions,
* secret mounting,
* browser templates,
* Playwright,
* egress allowlists,
* persistent workspaces,
* sandbox snapshots,
* auto-apply patches,
* PR creation,
* git push,
* enterprise admin policy,
* team/org controls,
* full dashboard.

## 27. Remaining Follow-Up Questions

1. Should `sandhost init --codex` require an existing hosted account immediately, or allow local unauthenticated runs before login?
2. Should `network: default` be allowed by default in the generated policy, or should the user explicitly enable it?
3. Should the default command timeout be 5 minutes or 10 minutes?
4. Should artifact retention default to 7 days, 14 days, or user-configured only?
5. Should the local host fingerprint be tied to WSL machine ID, SSH keys, generated sandhost keypair, or a combination?
6. Should `sandhost run` use the exact same grant path as MCP calls, or should local human CLI calls bypass Agent Auth during early development?
7. Should the first template image be published publicly or built locally during `init`?
8. Should the MVP support only `pnpm` projects initially, or any Node package manager?
9. Should sandhost parse test output for summaries, or leave summarization entirely to Codex?
10. Should failed artifact uploads fail the whole run, or return the run result with a degraded artifact status?

## 28. Summary

The MVP is now:

> Codex-first, hosted-authority, local-execution, Podman-backed sandboxed command execution.

The important product loop is:

```text
Codex
  → MCP
  → local sandhost runner
  → hosted Agent Auth grant
  → local Podman sandbox
  → private artifacts
  → audit trail
  → useful result
```

This is narrow enough to build, but still proves the core sandhost thesis:

> Coding agents should be able to run real project work somewhere safer, with scoped authority and an audit trail.

```
```
# sandhost MVP High-Level Design

## 1. Summary

sandhost is a secure execution layer for coding agents. The MVP allows Codex to run project commands inside local, policy-bound Podman sandboxes instead of directly on the user’s development environment.

The MVP focuses on one complete workflow:

> Codex requests permission to use sandhost, runs a project command in a local Podman sandbox, retrieves logs/artifacts/diffs, and leaves behind an audit trail — all under hosted capability-based authorization.

The MVP intentionally does not attempt to be a full subagent platform yet. It establishes the core primitives needed for the final product vision:

* agent identity,
* scoped grants,
* local sandboxed execution,
* command execution,
* logs,
* artifacts,
* diffs,
* audit events,
* private artifact storage,
* project-level policy.

## 2. Key MVP Decisions

### 2.1 Primary Agent Target

The MVP targets **Codex first**.

Other integrations such as Claude Code, Pi, ACP, and AHP remain future expansion paths.

### 2.2 Execution Location

Execution happens on the **user’s local laptop**, specifically targeting:

```text
Linux via WSL
```

The hosted sandhost service does not directly control the user’s machine. The local runner performs execution and makes outbound requests to the hosted control plane.

### 2.3 Runtime

The MVP uses **Podman**, not Docker.

Podman is the default runtime because it fits the Linux/WSL target, supports rootless-oriented local container execution, and avoids depending on a privileged always-running daemon.

The runtime abstraction should still allow future backends:

```text
PodmanRuntime      MVP
DockerRuntime      optional fallback, not MVP default
KubernetesRuntime  later
```

### 2.4 Control Plane

The control plane is **hosted only**.

The local component is not a control plane. It is a local runner/broker that:

* exposes MCP to Codex,
* builds the project archive,
* runs Podman,
* captures logs/artifacts/diffs,
* uploads artifacts,
* talks to the hosted control plane over HTTPS.

### 2.5 Artifact Storage

Artifacts are stored in **UploadThing**.

For the MVP, UploadThing artifacts are treated as private by default. sandhost stores metadata in its database and should control access through authenticated artifact routes or signed/private access mechanisms.

### 2.6 Approval Model

The authoritative approval model is **sandhost Agent Auth**.

Codex’s native approval UX can provide a useful extra confirmation step, but it is not the security boundary.

The security boundary is:

```text
hosted sandhost control plane
  → Better Auth / Agent Auth
  → active grant
  → capability check
  → project + machine + agent constraints
```

### 2.7 Grant Scope

The MVP supports both:

```text
one-shot grants
time-bound project grants
```

Default approval choices:

```text
Approve once
Approve for 30 minutes
Deny
```

No permanent grants in MVP.

### 2.8 Network Model

The MVP keeps network controls simple and honest.

Supported modes:

```text
none
default
```

`none` means the sandbox has no external network access.

`default` means the sandbox gets normal Podman networking.

The MVP should not claim hostname-level allowlists. Fine-grained network allowlists are deferred until a later runtime/policy phase.

### 2.9 Browser Support

Browsers and Playwright are deferred.

The MVP only ships the `node-ts` command-execution template.

### 2.10 Writeback Model

The sandbox never writes back to the local repo automatically.

sandhost returns:

```text
diff.patch
changed-files.txt
artifacts
logs
result.json
```

The agent or user may inspect/apply the patch later.

## 3. Product Goal

The MVP should prove that sandhost can safely sit between Codex and risky local execution.

A user should be able to say:

```text
Use sandhost to run pnpm test safely.
```

Codex should be able to:

1. call sandhost through MCP,
2. request the required capability grant,
3. receive user approval,
4. package the current project,
5. create a local Podman sandbox,
6. run the requested command,
7. capture logs,
8. capture artifacts,
9. capture a diff,
10. upload artifacts privately,
11. destroy the sandbox,
12. return a useful result.

## 4. MVP North Star

The MVP is successful when Codex can run a real project command through sandhost without the user needing to understand Podman, runtime flags, artifact upload, grants, or sandbox policy.

The expected first demo:

1. User opens a TypeScript repo in WSL.
2. User runs:

```bash
npx sandhost init --codex
```

3. sandhost configures Codex MCP access and project policy.
4. User asks Codex:

```text
Use sandhost to run pnpm test safely.
```

5. Codex calls the sandhost MCP tool.
6. sandhost requests a scoped grant.
7. User approves for the project, agent, and local machine.
8. sandhost runs the command in a local Podman sandbox.
9. sandhost returns logs, exit code, artifacts, and diff.
10. The sandbox is destroyed.
11. The hosted audit trail shows what happened.

## 5. Goals

### 5.1 Product Goals

* Make sandboxed command execution easy from Codex.
* Avoid direct execution of risky commands in the user’s working environment.
* Avoid giving Codex ambient authority over sandhost.
* Replace broad API keys with short-lived scoped capability grants.
* Provide a clear approval moment before execution.
* Capture useful results: logs, exit code, artifacts, and diff.
* Upload artifacts privately.
* Maintain an audit trail.
* Keep setup friction low.

### 5.2 Technical Goals

* Provide a Codex-compatible MCP server.
* Use Better Auth Agent Auth for hosted agent authorization.
* Use local Podman for sandbox execution.
* Use UploadThing for private artifact payloads.
* Store run metadata, artifact metadata, grants, and audit events in the hosted control plane.
* Support a high-quality `node-ts` runtime template.
* Avoid automatic local writeback.
* Keep the runtime interface clean enough to support Kubernetes later.

## 6. Non-Goals

The MVP does not include:

* Kubernetes execution,
* Docker as the default runtime,
* browser/Playwright templates,
* native ACP support,
* AHP shared session hosting,
* autonomous/background agents,
* secret mounting,
* arbitrary hostname-level network allowlists,
* pull request creation,
* git push,
* deployment,
* persistent workspaces,
* sandbox hibernation,
* full dashboard,
* full enterprise admin console,
* template marketplace,
* multi-agent orchestration,
* automatic patch application to the local repo.

## 7. Primary User

### 7.1 Individual Developer Using Codex

The first user is a developer running Codex in a local WSL/Linux development environment who wants Codex to run tests/builds/scripts without directly executing risky commands in the project environment.

## 8. Core Architecture

```text
┌──────────────────────────────────────────────┐
│ Codex                                        │
│----------------------------------------------│
│ User prompt                                  │
│ MCP client                                   │
│ Native tool approval UX where available      │
└──────────────────────────────────────────────┘
        │
        │ MCP
        ▼
┌──────────────────────────────────────────────┐
│ sandhost Local Runner                        │
│----------------------------------------------│
│ MCP server                                   │
│ Codex project context                        │
│ project archive builder                      │
│ local policy loader                          │
│ Podman runtime adapter                       │
│ log collector                                │
│ diff collector                               │
│ artifact collector                           │
│ UploadThing upload client                    │
└──────────────────────────────────────────────┘
        │
        │ HTTPS
        ▼
┌──────────────────────────────────────────────┐
│ Hosted sandhost Control Plane                │
│----------------------------------------------│
│ Better Auth                                  │
│ Agent Auth provider                          │
│ user/project/agent/host records              │
│ capability registry                          │
│ grant store                                  │
│ approval routes                              │
│ run metadata                                 │
│ artifact metadata                            │
│ audit event pipeline                         │
│ UploadThing integration                      │
└──────────────────────────────────────────────┘
        │
        │ signed/private artifact upload
        ▼
┌──────────────────────────────────────────────┐
│ UploadThing                                  │
│----------------------------------------------│
│ logs                                         │
│ stdout/stderr                                │
│ result.json                                  │
│ diff.patch                                   │
│ changed-files.txt                            │
│ configured artifact paths                    │
└──────────────────────────────────────────────┘
```

## 9. Major Components

## 9.1 `@sandhost/cli`

The CLI provides initialization, diagnostics, login, and local runner startup.

MVP commands:

```bash
sandhost init --codex
sandhost login
sandhost doctor
sandhost mcp
sandhost run "pnpm test"
sandhost policy show
```

Responsibilities:

* initialize project config,
* configure Codex MCP,
* create/update local sandhost policy,
* authenticate user with hosted control plane,
* verify Podman availability,
* start MCP server,
* provide a fallback non-agent command path.

## 9.2 `@sandhost/mcp`

The MCP server is the primary Codex integration.

The MVP should optimize for one high-level tool rather than forcing Codex to orchestrate low-level sandbox lifecycle steps.

Primary tool:

```ts
sandhost_run_project_command({
  command: string
  template?: string
  network?: "none" | "default"
  timeoutSeconds?: number
})
```

Supporting tools:

```ts
sandhost_list_templates()
sandhost_explain_policy()
sandhost_get_run({ runId })
sandhost_read_logs({ runId })
sandhost_get_diff({ runId })
sandhost_download_artifact({ artifactId })
```

Advanced tools may exist internally or behind an advanced flag:

```ts
sandhost_create_sandbox()
sandhost_run_command()
sandhost_destroy_sandbox()
```

The happy path should use `sandhost_run_project_command`.

## 9.3 Local Runner

The local runner performs all local execution work.

Responsibilities:

* load `.sandhost/policy.json`,
* detect project root,
* build workspace archive,
* request/verify grant status through hosted control plane,
* create Podman container,
* run command,
* enforce timeout,
* capture stdout/stderr,
* capture diff,
* collect artifacts,
* upload artifact payloads,
* report metadata to hosted control plane,
* clean up container/resources.

The local runner must only make outbound HTTPS requests.

## 9.4 Hosted Control Plane

The hosted control plane owns authority and metadata.

Responsibilities:

* user authentication,
* agent registration,
* local host registration,
* project registration,
* capability registry,
* grant requests,
* approval UI,
* grant validation,
* run metadata,
* artifact metadata,
* audit log,
* UploadThing integration.

## 9.5 Agent Auth Layer

Better Auth Agent Auth provides the protocol-level authorization substrate.

Use it for:

* discovery,
* agent identity,
* agent registration,
* capability listing,
* grant request,
* user approval,
* short-lived JWT issuance,
* replay protection,
* audit hooks.

Do not let Agent Auth become the whole internal domain model.

sandhost should wrap it behind an internal interface:

```ts
interface AgentAuthority {
  getAgentSession(headers: Headers): Promise<AgentSession | null>
  requestGrant(input: GrantRequestInput): Promise<GrantRequest>
  requireCapability(input: RequireCapabilityInput): Promise<AuthorizedCapability>
  listCapabilities(context: CapabilityContext): Promise<Capability[]>
}
```

MVP implementation:

```text
BetterAuthAgentAuthority
```

## 9.6 Podman Runtime Adapter

The Podman runtime adapter is the MVP sandbox backend.

Responsibilities:

* pull runtime image,
* create container,
* copy workspace into container,
* apply CPU/memory limits,
* apply network mode,
* run command,
* stream/capture logs,
* copy artifacts out,
* destroy container.

Example runtime interface:

```ts
interface SandboxRuntime {
  createSandbox(input: CreateSandboxInput): Promise<SandboxHandle>
  uploadWorkspace(handle: SandboxHandle, archive: WorkspaceArchive): Promise<void>
  runCommand(handle: SandboxHandle, command: CommandSpec): Promise<RunResult>
  collectArtifacts(handle: SandboxHandle): Promise<ArtifactBundle>
  destroySandbox(handle: SandboxHandle): Promise<void>
}
```

MVP implementation:

```text
PodmanRuntime
```

Future implementation:

```text
KubernetesRuntime
```

## 10. Codex Integration

`npx sandhost init --codex` should configure Codex to access the local MCP server.

Target outcome:

```text
Codex can call sandhost_run_project_command from the current repo.
```

Generated/updated project files:

```text
.sandhost/project.json
.sandhost/policy.json
AGENTS.md
```

Generated/updated Codex config:

```text
Codex MCP configuration
```

The exact file path and config format should be handled by the CLI based on the local Codex environment.

Suggested AGENTS.md insertion:

```md
## sandhost

Use sandhost for commands that may execute generated, dependency-installing, destructive, or risky code.

Prefer:

- `sandhost_run_project_command` through MCP
- `sandhost run "<command>"` as a CLI fallback

Do not apply sandbox changes to the local repo automatically. Inspect `diff.patch` first.
```

## 11. Capability Model

## 11.1 MVP Capabilities

```text
sandbox.list_templates
sandbox.explain_policy
sandbox.run_project_command
sandbox.read_logs
sandbox.get_diff
sandbox.download_artifact
```

Internally, `sandbox.run_project_command` covers:

```text
workspace.archive
sandbox.create
sandbox.upload_workspace
sandbox.run_command
sandbox.collect_artifacts
sandbox.collect_diff
sandbox.destroy
```

The user should approve the high-level action, not every internal lifecycle step.

## 11.2 Capability Constraints

Capability grants are constrained by:

* user,
* project,
* local machine/host,
* agent,
* template,
* runtime,
* network mode,
* max TTL,
* max CPU,
* max memory,
* command timeout,
* artifact paths,
* excluded paths.

Example grant:

```json
{
  "capabilities": [
    "sandbox.run_project_command",
    "sandbox.read_logs",
    "sandbox.get_diff",
    "sandbox.download_artifact"
  ],
  "constraints": {
    "projectId": "proj_123",
    "hostId": "host_123",
    "agentId": "agent_codex_123",
    "templates": ["node-ts"],
    "runtime": "podman",
    "network": ["none", "default"],
    "maxTtlSeconds": 1800,
    "maxCpu": 2,
    "maxMemoryMb": 4096,
    "maxTimeoutSeconds": 600,
    "secrets": [],
    "artifactPaths": [
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "*.patch"
    ]
  }
}
```

## 11.3 Grant Types

```ts
type GrantScope =
  | { type: "one_shot"; commandHash: string }
  | { type: "project_window"; projectId: string; hostId: string; agentId: string; expiresAt: string }
```

MVP approval buttons:

```text
Approve once
Approve for 30 minutes
Deny
```

No permanent approval in MVP.

## 12. Approval Flow

The MVP approval flow should prioritize clarity over protocol ambition.

Flow:

1. Codex calls `sandhost_run_project_command`.
2. Local runner asks hosted control plane whether an active grant exists.
3. If no grant exists, hosted control plane creates a grant request.
4. User approves in sandhost-hosted approval UI.
5. Control plane issues short-lived capability authority.
6. Local runner executes command.
7. Control plane records audit events.

Approval copy:

```text
Codex wants to run a project command with sandhost.

Project:
acme/web

Machine:
Lucas WSL environment

Requested:
- Package project workspace
- Create local Podman sandbox
- Run command inside sandbox
- Capture logs
- Capture diff
- Upload private artifacts
- Destroy sandbox

Command:
pnpm test

Policy:
- Runtime: Podman
- Template: node-ts
- Network: none/default as requested
- Secrets: none
- Auto-writeback: disabled
- Max CPU: 2
- Max memory: 4 GB
- Max timeout: 10 minutes

Approve once
Approve for 30 minutes
Deny
```

## 13. Policy Model

MVP policy file:

```json
{
  "version": 1,
  "defaultTemplate": "node-ts",
  "runtime": "podman",
  "defaultNetwork": "none",
  "allowedNetworks": ["none", "default"],
  "maxTtlSeconds": 1800,
  "maxTimeoutSeconds": 600,
  "resources": {
    "cpu": 2,
    "memoryMb": 4096
  },
  "secrets": {
    "allow": []
  },
  "artifacts": [
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    "*.patch"
  ],
  "exclude": [
    ".git",
    "node_modules",
    ".env",
    ".env.*",
    "dist",
    "build",
    "coverage",
    ".sandhost/runs"
  ]
}
```

Policy compilation combines:

1. system hard limits,
2. hosted project policy,
3. local project policy,
4. template defaults,
5. grant constraints,
6. requested command options.

The most restrictive effective value should win.

## 14. Workspace Model

The MVP uses archive copy-in/copy-out.

It does not bind-mount the local project directory into the sandbox.

### 14.1 Archive Creation

The local runner builds a project archive from the current repo.

File selection should start with:

```bash
git ls-files -co --exclude-standard
```

Then apply:

* `.sandhost/policy.json` exclusions,
* sensitive-file exclusions,
* generated-output exclusions.

Default exclusions:

```text
.git
node_modules
.env
.env.*
dist
build
coverage
.sandhost/runs
```

### 14.2 Workspace Location

Inside the sandbox:

```text
/workspace
```

Artifacts are written to:

```text
/artifacts
```

The command runs from:

```text
/workspace
```

## 15. Diff Strategy

The MVP should compute diffs by creating a baseline git repository inside the sandbox.

Do not upload `.git`.

Flow inside sandbox:

```bash
cd /workspace

git init
git config user.email "sandhost@example.local"
git config user.name "sandhost"
git add -A
git commit -m "sandhost baseline"

# run user command here

git add -N .
git diff --binary HEAD > /artifacts/diff.patch
git status --porcelain=v1 > /artifacts/changed-files.txt
```

Benefits:

* avoids uploading `.git`,
* avoids leaking remotes/history,
* produces normal patch files,
* captures modifications and deletions,
* captures new files with `git add -N`,
* keeps the diff logic inside the sandbox.

For non-git directories, fallback behavior:

* snapshot file hashes before execution,
* snapshot file hashes after execution,
* emit `changed-files.txt`,
* optionally skip `diff.patch`.

## 16. Runtime Template: `node-ts`

The first template is `node-ts`.

Base requirements:

```text
Node.js LTS
npm
pnpm
git
bash
coreutils
ripgrep
curl
ca-certificates
basic build tools
```

Runtime defaults:

```text
user: non-root
workdir: /workspace
artifact dir: /artifacts
network: none unless requested
memory: 4 GB max
cpu: 2 max
timeout: 10 minutes default
```

Browsers and Playwright are deferred to a later `node-ts-browser` template.

## 17. Podman Execution Model

Example conceptual command:

```bash
podman run \
  --rm \
  --network none \
  --memory 4g \
  --cpus 2 \
  --userns keep-id \
  --name sandhost-run-<id> \
  sandhost-node-ts:<version> \
  /sandhost/runner/run.sh
```

The exact flags should be validated during implementation on WSL.

Execution principles:

* prefer rootless Podman,
* no privileged containers,
* no host project bind mount,
* no automatic host writeback,
* no secrets,
* resource limits required,
* timeout required,
* network disabled by default,
* cleanup required.

## 18. Network Model

Supported MVP network modes:

```text
none
default
```

### 18.1 `none`

Use for commands that should not require internet.

Examples:

```text
pnpm test
npm test
pnpm build
tsc --noEmit
```

### 18.2 `default`

Use when the command needs internet access.

Examples:

```text
pnpm install
npm install
curl-based scripts
dependency downloads
```

Approval UI must clearly state when `default` networking is requested.

MVP does not support true hostname allowlists.

A later phase may add:

```text
package-install-only
egress proxy
hostname allowlists
Kubernetes NetworkPolicy
```

## 19. Artifact Model

The local runner collects artifacts after the command completes.

Default artifacts:

```text
/artifacts/result.json
/artifacts/logs.txt
/artifacts/stdout.txt
/artifacts/stderr.txt
/artifacts/diff.patch
/artifacts/changed-files.txt
```

Configured project artifacts:

```text
coverage/**
test-results/**
playwright-report/**
*.patch
```

The local runner uploads artifact payloads to UploadThing.

The hosted control plane stores artifact metadata:

```ts
type Artifact = {
  id: string
  runId: string
  projectId: string
  name: string
  path: string
  contentType?: string
  sizeBytes?: number
  uploadThingKey: string
  private: true
  createdAt: string
  retentionExpiresAt?: string
}
```

Artifact downloads should go through sandhost authorization, even if UploadThing provides the underlying storage.

## 20. Run Result

MCP result shape:

```ts
type RunProjectCommandResult = {
  runId: string
  status: "succeeded" | "failed" | "cancelled" | "timed_out"
  exitCode: number | null
  durationMs: number
  command: string
  network: "none" | "default"
  summary: string
  logsRef: string
  stdoutRef: string
  stderrRef: string
  diffRef?: string
  changedFilesRef?: string
  artifacts: ArtifactRef[]
  auditRef: string
}
```

Example response to Codex:

```json
{
  "runId": "run_123",
  "status": "failed",
  "exitCode": 1,
  "durationMs": 42100,
  "command": "pnpm test",
  "network": "none",
  "summary": "The test suite failed in src/auth/session.test.ts.",
  "logsRef": "sandhost://runs/run_123/logs",
  "diffRef": "sandhost://runs/run_123/diff",
  "artifacts": [
    {
      "name": "changed-files.txt",
      "uri": "sandhost://artifacts/art_123"
    }
  ],
  "auditRef": "sandhost://runs/run_123/audit"
}
```

## 21. Audit Model

MVP audit events:

```text
agent.registered
host.registered
project.initialized
grant.requested
grant.approved
grant.denied
capability.executed
run.created
workspace.archived
sandbox.created
command.started
command.finished
artifact.uploaded
diff.created
sandbox.destroyed
grant.expired
```

Audit event shape:

```ts
type AuditEvent = {
  id: string
  type: string
  userId: string
  projectId?: string
  hostId?: string
  agentId?: string
  grantId?: string
  runId?: string
  timestamp: string
  metadata: Record<string, unknown>
}
```

## 22. Security Model

### 22.1 MVP Security Principles

* Local execution only.
* Rootless Podman preferred.
* No host project bind mount.
* No automatic local writeback.
* No secrets.
* No privileged containers.
* No permanent grants.
* Network disabled by default.
* Resource limits required.
* Timeout required.
* Private artifact storage.
* All meaningful actions audited.
* Hosted control plane authorizes capability use.
* Grants are scoped to user + project + local host + agent.

### 22.2 Threats Reduced

The MVP reduces risk from:

* Codex accidentally modifying local files,
* generated scripts running directly in the dev environment,
* dependency scripts executing locally,
* runaway commands,
* untracked agent behavior,
* accidental `.env` upload,
* broad long-lived API key usage,
* automatic patch application.

### 22.3 Threats Not Fully Solved

The MVP does not fully solve:

* malicious dependency behavior when network is enabled,
* all container escape classes,
* kernel-level sandbox hardening,
* fine-grained egress control,
* secret misuse,
* browser automation risk,
* supply-chain compromise,
* side-channel attacks,
* malware-analysis-grade isolation.

The product should be explicit that the MVP provides local sandboxed execution, not a hardened untrusted-code microVM boundary.

## 23. Data Model

### 23.1 Project

```ts
type Project = {
  id: string
  userId: string
  name: string
  localFingerprint: string
  policyId: string
  createdAt: string
}
```

### 23.2 Host

```ts
type Host = {
  id: string
  userId: string
  name: string
  platform: "linux-wsl"
  runtime: "podman"
  fingerprint: string
  createdAt: string
  lastSeenAt: string
}
```

### 23.3 Agent

```ts
type Agent = {
  id: string
  userId: string
  hostId: string
  kind: "codex"
  displayName: string
  createdAt: string
  lastSeenAt: string
}
```

### 23.4 Grant

```ts
type Grant = {
  id: string
  userId: string
  projectId: string
  hostId: string
  agentId: string
  capabilities: string[]
  constraints: Record<string, unknown>
  scope: "one_shot" | "project_window"
  status: "pending" | "approved" | "denied" | "expired" | "revoked"
  expiresAt?: string
  createdAt: string
  approvedAt?: string
}
```

### 23.5 Run

```ts
type Run = {
  id: string
  userId: string
  projectId: string
  hostId: string
  agentId: string
  grantId: string
  command: string
  template: string
  runtime: "podman"
  network: "none" | "default"
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out"
  exitCode?: number
  startedAt?: string
  finishedAt?: string
  durationMs?: number
}
```

### 23.6 Artifact

```ts
type Artifact = {
  id: string
  runId: string
  projectId: string
  name: string
  path: string
  contentType?: string
  sizeBytes?: number
  uploadThingKey: string
  private: true
  createdAt: string
}
```

## 24. Implementation Phases

### Phase 0: Project Skeleton

* Monorepo/package structure.
* Hosted server skeleton.
* CLI skeleton.
* MCP server skeleton.
* Podman runtime spike.
* UploadThing integration spike.

### Phase 1: Local Podman Run Without Agent Auth

Goal:

```bash
sandhost run "pnpm test"
```

Must support:

* project archive,
* Podman container execution,
* no-network/default-network mode,
* stdout/stderr capture,
* exit code,
* diff generation,
* artifact collection,
* cleanup.

### Phase 2: Hosted Metadata and UploadThing

Add:

* hosted project records,
* hosted run records,
* private artifact upload,
* artifact metadata,
* audit metadata.

### Phase 3: Codex MCP Integration

Add:

* `sandhost init --codex`,
* Codex MCP config generation,
* `sandhost_run_project_command`,
* inspection tools,
* AGENTS.md insertion.

### Phase 4: Agent Auth Grants

Add:

* Agent Auth provider,
* capability registry,
* agent/host registration,
* grant request,
* approval UI,
* one-shot grant,
* 30-minute project-window grant,
* short-lived execution authority,
* audit hooks.

### Phase 5: MVP Polish

Add:

* `sandhost doctor`,
* stronger error messages,
* WSL-specific diagnostics,
* Podman installation guidance,
* run summary formatting,
* artifact download authorization,
* docs,
* first demo flow.

## 25. MVP Acceptance Criteria

The MVP is complete when:

1. A user on Linux via WSL can run `npx sandhost init --codex`.
2. sandhost detects or validates Podman.
3. Codex can call the sandhost MCP server.
4. Codex can invoke `sandhost_run_project_command`.
5. The first run triggers a hosted sandhost approval flow.
6. Approval is scoped to user, project, host, and Codex agent identity.
7. The local runner archives the project without `.git`, `node_modules`, or `.env`.
8. The command runs inside a local Podman sandbox.
9. Network mode is explicit: `none` or `default`.
10. The sandbox does not bind-mount or automatically modify the local repo.
11. sandhost captures stdout, stderr, exit code, duration, logs, diff, and changed files.
12. Artifacts are uploaded privately through UploadThing.
13. Run metadata and audit events are stored in the hosted control plane.
14. The sandbox is cleaned up after execution.
15. Codex receives a concise result it can use to continue the coding task.

## 26. Deferred Features

Deferred until after MVP:

* Kubernetes backend,
* Docker fallback,
* Claude Code integration,
* Pi integration,
* ACP,
* AHP,
* subagent sessions,
* secret mounting,
* browser templates,
* Playwright,
* egress allowlists,
* persistent workspaces,
* sandbox snapshots,
* auto-apply patches,
* PR creation,
* git push,
* enterprise admin policy,
* team/org controls,
* full dashboard.

## 27. Remaining Follow-Up Questions

1. Should `sandhost init --codex` require an existing hosted account immediately, or allow local unauthenticated runs before login?
2. Should `network: default` be allowed by default in the generated policy, or should the user explicitly enable it?
3. Should the default command timeout be 5 minutes or 10 minutes?
4. Should artifact retention default to 7 days, 14 days, or user-configured only?
5. Should the local host fingerprint be tied to WSL machine ID, SSH keys, generated sandhost keypair, or a combination?
6. Should `sandhost run` use the exact same grant path as MCP calls, or should local human CLI calls bypass Agent Auth during early development?
7. Should the first template image be published publicly or built locally during `init`?
8. Should the MVP support only `pnpm` projects initially, or any Node package manager?
9. Should sandhost parse test output for summaries, or leave summarization entirely to Codex?
10. Should failed artifact uploads fail the whole run, or return the run result with a degraded artifact status?

## 28. Summary

The MVP is now:

> Codex-first, hosted-authority, local-execution, Podman-backed sandboxed command execution.

The important product loop is:

```text
Codex
  → MCP
  → local sandhost runner
  → hosted Agent Auth grant
  → local Podman sandbox
  → private artifacts
  → audit trail
  → useful result
```

This is narrow enough to build, but still proves the core sandhost thesis:

> Coding agents should be able to run real project work somewhere safer, with scoped authority and an audit trail.

```
```
