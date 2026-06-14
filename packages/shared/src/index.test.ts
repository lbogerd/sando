import { describe, expect, it } from "vitest"

import {
	auditEventTypes,
	asId,
	defaultSandoPolicy,
	err,
	isAppendAuditEventInput,
	isAppendAuditEventResult,
	isAuditEventRecord,
	isArtifactRecord,
	hostPlatforms,
	isCreateRunInput,
	isCreateRunResult,
	isFinishRunInput,
	isFinishRunResult,
	isHostRecord,
	isIdOfKind,
	isProjectRecord,
	isProjectRegistrationResult,
	isHostRegistrationResult,
	isRegisterHostInput,
	isRegisterProjectInput,
	isRunProjectCommandInput,
	isRunProjectCommandResult,
	isListRunArtifactsResult,
	isRunRecord,
	isSandoPolicy,
	ok,
	parseAppendAuditEventInput,
	parseAppendAuditEventResult,
	parseAuditEventRecord,
	parseArtifactRecord,
	parseCreateRunInput,
	parseCreateRunResult,
	parseFinishRunInput,
	parseFinishRunResult,
	parseHostRecord,
	parseHostRegistrationResult,
	parseProjectRecord,
	parseProjectRegistrationResult,
	parseRegisterHostInput,
	parseRegisterProjectInput,
	parseRunProjectCommandInput,
	parseRunProjectCommandResult,
	parseListRunArtifactsResult,
	parseRunRecord,
	parseSandoPolicy,
	runStatuses,
	sandoError,
	type ProjectId,
	type Result,
	type RunId,
} from "./index.js"

describe("shared id helpers", () => {
	it("brands IDs by kind without changing their runtime value", () => {
		const projectId: ProjectId = asId("project", "proj_123")
		const runId: RunId = asId("run", "run_123")

		expect(projectId).toBe("proj_123")
		expect(runId).toBe("run_123")
	})

	it("checks IDs against their configured prefix", () => {
		expect(isIdOfKind("project", "proj_123")).toBe(true)
		expect(isIdOfKind("project", "run_123")).toBe(false)
	})
})

describe("shared result helpers", () => {
	it("creates success results", () => {
		const result: Result<number> = ok(42)

		expect(result).toEqual({ ok: true, value: 42 })
	})

	it("creates error results with structured Sando errors", () => {
		const error = sandoError({
			code: "POLICY_VIOLATION",
			message: "Network mode is not allowed by policy.",
			details: { network: "default" },
		})
		const result: Result<number> = err(error)

		expect(result).toEqual({ ok: false, error })
	})
})

describe("shared policy schema", () => {
	it("accepts the default MVP policy", () => {
		expect(parseSandoPolicy(defaultSandoPolicy)).toEqual({
			ok: true,
			value: defaultSandoPolicy,
		})
		expect(isSandoPolicy(defaultSandoPolicy)).toBe(true)
	})

	it("rejects policies whose default network is not allowed", () => {
		const result = parseSandoPolicy({
			...defaultSandoPolicy,
			defaultNetwork: "default",
			allowedNetworks: ["none"],
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("VALIDATION_FAILED")
			expect(result.error.details).toEqual({
				issues: [
					{
						path: "$.defaultNetwork",
						message: "Expected the default network to be allowed.",
					},
				],
			})
		}
	})
})

describe("run project command schemas", () => {
	it("accepts valid MCP run command input", () => {
		const input = {
			command: "pnpm test",
			template: "node-ts",
			network: "none",
			timeoutSeconds: 600,
		}

		expect(parseRunProjectCommandInput(input)).toEqual({
			ok: true,
			value: input,
		})
		expect(isRunProjectCommandInput(input)).toBe(true)
	})

	it("rejects invalid MCP run command input", () => {
		const result = parseRunProjectCommandInput({
			command: "",
			network: "private",
			timeoutSeconds: 0,
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.details).toEqual({
				issues: [
					{ path: "$.command", message: "Expected a non-empty string." },
					{ path: "$.network", message: "Expected a supported network mode." },
					{ path: "$.timeoutSeconds", message: "Expected a positive integer." },
				],
			})
		}
	})

	it("accepts valid MCP run command results", () => {
		const result = {
			runId: "run_123",
			status: "failed",
			exitCode: 1,
			durationMs: 42100,
			command: "pnpm test",
			network: "none",
			summary: "The test suite failed.",
			logsRef: "sandhost://runs/run_123/logs",
			stdoutRef: "sandhost://runs/run_123/stdout",
			stderrRef: "sandhost://runs/run_123/stderr",
			diffRef: "sandhost://runs/run_123/diff",
			changedFilesRef: "sandhost://runs/run_123/changed-files",
			artifacts: [
				{
					id: "art_123",
					name: "changed-files.txt",
					uri: "sandhost://artifacts/art_123",
					sizeBytes: 128,
				},
			],
			auditRef: "sandhost://runs/run_123/audit",
		}

		expect(parseRunProjectCommandResult(result)).toEqual({
			ok: true,
			value: result,
		})
		expect(isRunProjectCommandResult(result)).toBe(true)
	})

	it("rejects invalid MCP run command results", () => {
		const result = parseRunProjectCommandResult({
			runId: "proj_123",
			status: "running",
			exitCode: -1,
			durationMs: -1,
			command: "pnpm test",
			network: "none",
			summary: "still running",
			logsRef: "http://example.test/logs",
			stdoutRef: "sandhost://runs/run_123/stdout",
			stderrRef: "sandhost://runs/run_123/stderr",
			artifacts: [{ name: "", uri: "nope" }],
			auditRef: "sandhost://runs/run_123/audit",
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("VALIDATION_FAILED")
			expect(result.error.details).toEqual({
				issues: [
					{ path: "$.runId", message: "Expected a run ID." },
					{ path: "$.status", message: "Expected a terminal run status." },
					{ path: "$.exitCode", message: "Expected null or a non-negative integer." },
					{ path: "$.durationMs", message: "Expected a non-negative integer." },
					{ path: "$.logsRef", message: "Expected a sandhost URI." },
					{ path: "$.artifacts[0].name", message: "Expected a non-empty string." },
					{ path: "$.artifacts[0].uri", message: "Expected a sandhost URI." },
				],
			})
		}
	})
})

describe("artifact metadata schemas", () => {
	it("accepts valid artifact records and list results", () => {
		const artifact = {
			id: "art_123",
			runId: "run_123",
			projectId: "proj_123",
			name: "changed-files.txt",
			path: "/artifacts/changed-files.txt",
			contentType: "text/plain",
			sizeBytes: 128,
			uploadThingKey: "ut_123",
			private: true,
			createdAt: "2026-06-14T18:00:00.000Z",
			retentionExpiresAt: "2026-07-14T18:00:00.000Z",
		}
		const result = { artifacts: [artifact] }

		expect(parseArtifactRecord(artifact)).toEqual({ ok: true, value: artifact })
		expect(isArtifactRecord(artifact)).toBe(true)
		expect(parseListRunArtifactsResult(result)).toEqual({ ok: true, value: result })
		expect(isListRunArtifactsResult(result)).toBe(true)
	})

	it("rejects invalid artifact records", () => {
		const result = parseArtifactRecord({
			id: "run_123",
			runId: "proj_123",
			projectId: "host_123",
			name: "",
			path: "",
			contentType: "",
			sizeBytes: -1,
			uploadThingKey: "",
			private: false,
			createdAt: "",
			retentionExpiresAt: "",
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("VALIDATION_FAILED")
			expect(result.error.details).toEqual({
				issues: [
					{ path: "$.id", message: "Expected an artifact ID." },
					{ path: "$.runId", message: "Expected a run ID." },
					{ path: "$.projectId", message: "Expected a project ID." },
					{ path: "$.name", message: "Expected a non-empty string." },
					{ path: "$.path", message: "Expected a non-empty string." },
					{ path: "$.contentType", message: "Expected a non-empty string." },
					{ path: "$.sizeBytes", message: "Expected a non-negative integer." },
					{ path: "$.uploadThingKey", message: "Expected a non-empty string." },
					{ path: "$.private", message: "Expected a private artifact." },
					{ path: "$.createdAt", message: "Expected a non-empty string." },
					{ path: "$.retentionExpiresAt", message: "Expected a non-empty string." },
				],
			})
		}
	})
})

describe("project registration schemas", () => {
	it("accepts valid project registration input and result payloads", () => {
		const input = {
			name: "Sandhost",
			localFingerprint: "git:/workspace/sandhost#main",
			policyId: "policy_default",
		}
		const project = {
			id: "proj_123",
			userId: "user_123",
			name: "Sandhost",
			localFingerprint: "git:/workspace/sandhost#main",
			policyId: "policy_default",
			createdAt: "2026-06-14T17:30:00.000Z",
		}
		const registration = {
			project,
			created: true,
		}

		expect(parseRegisterProjectInput(input)).toEqual({ ok: true, value: input })
		expect(isRegisterProjectInput(input)).toBe(true)
		expect(parseProjectRecord(project)).toEqual({ ok: true, value: project })
		expect(isProjectRecord(project)).toBe(true)
		expect(parseProjectRegistrationResult(registration)).toEqual({
			ok: true,
			value: registration,
		})
		expect(isProjectRegistrationResult(registration)).toBe(true)
	})

	it("rejects invalid project registration input and records", () => {
		const input = parseRegisterProjectInput({
			name: "",
			localFingerprint: "",
			policyId: "proj_123",
		})
		const project = parseProjectRecord({
			id: "run_123",
			userId: "proj_123",
			name: "",
			localFingerprint: "",
			policyId: "project-policy",
			createdAt: "",
		})

		expect(input.ok).toBe(false)
		if (!input.ok) {
			expect(input.error.code).toBe("VALIDATION_FAILED")
			expect(input.error.details).toEqual({
				issues: [
					{ path: "$.name", message: "Expected a non-empty string." },
					{ path: "$.localFingerprint", message: "Expected a non-empty string." },
					{ path: "$.policyId", message: "Expected a policy ID." },
				],
			})
		}

		expect(project.ok).toBe(false)
		if (!project.ok) {
			expect(project.error.code).toBe("VALIDATION_FAILED")
			expect(project.error.details).toEqual({
				issues: [
					{ path: "$.id", message: "Expected a project ID." },
					{ path: "$.userId", message: "Expected a user ID." },
					{ path: "$.name", message: "Expected a non-empty string." },
					{ path: "$.localFingerprint", message: "Expected a non-empty string." },
					{ path: "$.policyId", message: "Expected a policy ID." },
					{ path: "$.createdAt", message: "Expected a non-empty string." },
				],
			})
		}
	})
})

describe("host registration schemas", () => {
	it("exposes supported host platforms", () => {
		expect(hostPlatforms).toEqual(["linux-wsl"])
	})

	it("accepts valid host registration input and result payloads", () => {
		const input = {
			name: "WSL dev box",
			platform: "linux-wsl",
			runtime: "podman",
			fingerprint: "wsl:ubuntu:machine-id",
		}
		const host = {
			id: "host_123",
			userId: "user_123",
			name: "WSL dev box",
			platform: "linux-wsl",
			runtime: "podman",
			fingerprint: "wsl:ubuntu:machine-id",
			createdAt: "2026-06-14T17:30:00.000Z",
			lastSeenAt: "2026-06-14T17:30:00.000Z",
		}
		const registration = {
			host,
			created: true,
		}

		expect(parseRegisterHostInput(input)).toEqual({ ok: true, value: input })
		expect(isRegisterHostInput(input)).toBe(true)
		expect(parseHostRecord(host)).toEqual({ ok: true, value: host })
		expect(isHostRecord(host)).toBe(true)
		expect(parseHostRegistrationResult(registration)).toEqual({
			ok: true,
			value: registration,
		})
		expect(isHostRegistrationResult(registration)).toBe(true)
	})

	it("rejects invalid host registration input and records", () => {
		const input = parseRegisterHostInput({
			name: "",
			platform: "macos",
			runtime: "vm",
			fingerprint: "",
		})
		const host = parseHostRecord({
			id: "proj_123",
			userId: "host_123",
			name: "",
			platform: "windows",
			runtime: "containerd",
			fingerprint: "",
			createdAt: "",
			lastSeenAt: "",
		})

		expect(input.ok).toBe(false)
		if (!input.ok) {
			expect(input.error.code).toBe("VALIDATION_FAILED")
			expect(input.error.details).toEqual({
				issues: [
					{ path: "$.name", message: "Expected a non-empty string." },
					{ path: "$.platform", message: "Expected a supported host platform." },
					{ path: "$.runtime", message: "Expected a supported sandbox runtime." },
					{ path: "$.fingerprint", message: "Expected a non-empty string." },
				],
			})
		}

		expect(host.ok).toBe(false)
		if (!host.ok) {
			expect(host.error.code).toBe("VALIDATION_FAILED")
			expect(host.error.details).toEqual({
				issues: [
					{ path: "$.id", message: "Expected a host ID." },
					{ path: "$.userId", message: "Expected a user ID." },
					{ path: "$.name", message: "Expected a non-empty string." },
					{ path: "$.platform", message: "Expected a supported host platform." },
					{ path: "$.runtime", message: "Expected a supported sandbox runtime." },
					{ path: "$.fingerprint", message: "Expected a non-empty string." },
					{ path: "$.createdAt", message: "Expected a non-empty string." },
					{ path: "$.lastSeenAt", message: "Expected a non-empty string." },
				],
			})
		}
	})
})

describe("run metadata schemas", () => {
	it("exposes queued, running, and terminal run statuses", () => {
		expect(runStatuses).toEqual([
			"queued",
			"running",
			"succeeded",
			"failed",
			"cancelled",
			"timed_out",
		])
	})

	it("accepts valid create run input and result payloads", () => {
		const input = {
			projectId: "proj_123",
			hostId: "host_123",
			agentId: "agent_123",
			grantId: "grant_123",
			command: "pnpm test",
			template: "node-ts",
			runtime: "podman",
			network: "none",
		}
		const run = {
			id: "run_123",
			userId: "user_123",
			...input,
			status: "queued",
		}
		const result = { run }

		expect(parseCreateRunInput(input)).toEqual({ ok: true, value: input })
		expect(isCreateRunInput(input)).toBe(true)
		expect(parseRunRecord(run)).toEqual({ ok: true, value: run })
		expect(isRunRecord(run)).toBe(true)
		expect(parseCreateRunResult(result)).toEqual({ ok: true, value: result })
		expect(isCreateRunResult(result)).toBe(true)
	})

	it("rejects invalid create run input and records", () => {
		const input = parseCreateRunInput({
			projectId: "run_123",
			hostId: "proj_123",
			agentId: "host_123",
			grantId: "agent_123",
			command: "",
			template: "",
			runtime: "vm",
			network: "private",
		})
		const run = parseRunRecord({
			id: "proj_123",
			userId: "run_123",
			projectId: "host_123",
			hostId: "agent_123",
			agentId: "grant_123",
			grantId: "run_123",
			command: "",
			template: "",
			runtime: "vm",
			network: "private",
			status: "waiting",
			exitCode: -1,
			durationMs: -1,
		})

		expect(input.ok).toBe(false)
		if (!input.ok) {
			expect(input.error.code).toBe("VALIDATION_FAILED")
			expect(input.error.details).toEqual({
				issues: [
					{ path: "$.projectId", message: "Expected a project ID." },
					{ path: "$.hostId", message: "Expected a host ID." },
					{ path: "$.agentId", message: "Expected an agent ID." },
					{ path: "$.grantId", message: "Expected a grant ID." },
					{ path: "$.command", message: "Expected a non-empty string." },
					{ path: "$.template", message: "Expected a non-empty string." },
					{ path: "$.runtime", message: "Expected a supported sandbox runtime." },
					{ path: "$.network", message: "Expected a supported network mode." },
				],
			})
		}

		expect(run.ok).toBe(false)
		if (!run.ok) {
			expect(run.error.code).toBe("VALIDATION_FAILED")
			expect(run.error.details).toEqual({
				issues: [
					{ path: "$.id", message: "Expected a run ID." },
					{ path: "$.userId", message: "Expected a user ID." },
					{ path: "$.projectId", message: "Expected a project ID." },
					{ path: "$.hostId", message: "Expected a host ID." },
					{ path: "$.agentId", message: "Expected an agent ID." },
					{ path: "$.grantId", message: "Expected a grant ID." },
					{ path: "$.command", message: "Expected a non-empty string." },
					{ path: "$.template", message: "Expected a non-empty string." },
					{ path: "$.runtime", message: "Expected a supported sandbox runtime." },
					{ path: "$.network", message: "Expected a supported network mode." },
					{ path: "$.status", message: "Expected a supported run status." },
					{ path: "$.exitCode", message: "Expected null or a non-negative integer." },
					{ path: "$.durationMs", message: "Expected a non-negative integer." },
				],
			})
		}
	})

	it("accepts valid finish run input and result payloads", () => {
		const input = {
			status: "failed",
			exitCode: 1,
			durationMs: 42100,
		}
		const result = {
			run: {
				id: "run_123",
				userId: "user_123",
				projectId: "proj_123",
				hostId: "host_123",
				agentId: "agent_123",
				grantId: "grant_123",
				command: "pnpm test",
				template: "node-ts",
				runtime: "podman",
				network: "none",
				status: "failed",
				exitCode: 1,
				finishedAt: "2026-06-14T18:00:00.000Z",
				durationMs: 42100,
			},
		}

		expect(parseFinishRunInput(input)).toEqual({ ok: true, value: input })
		expect(isFinishRunInput(input)).toBe(true)
		expect(parseFinishRunResult(result)).toEqual({ ok: true, value: result })
		expect(isFinishRunResult(result)).toBe(true)
	})

	it("rejects invalid finish run input", () => {
		const result = parseFinishRunInput({
			status: "queued",
			exitCode: -1,
			durationMs: -1,
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("VALIDATION_FAILED")
			expect(result.error.details).toEqual({
				issues: [
					{ path: "$.status", message: "Expected a terminal run status." },
					{ path: "$.exitCode", message: "Expected null or a non-negative integer." },
					{ path: "$.durationMs", message: "Expected a non-negative integer." },
				],
			})
		}
	})
})

describe("audit event schemas", () => {
	it("exposes supported audit event types", () => {
		expect(auditEventTypes).toEqual([
			"agent.registered",
			"host.registered",
			"project.initialized",
			"grant.requested",
			"grant.approved",
			"grant.denied",
			"capability.executed",
			"run.created",
			"workspace.archived",
			"sandbox.created",
			"command.started",
			"command.finished",
			"artifact.uploaded",
			"diff.created",
			"sandbox.destroyed",
			"grant.expired",
		])
	})

	it("accepts valid append audit event input and result payloads", () => {
		const input = {
			type: "command.finished",
			projectId: "proj_123",
			hostId: "host_123",
			agentId: "agent_123",
			grantId: "grant_123",
			runId: "run_123",
			metadata: {
				exitCode: 1,
				command: "pnpm test",
				flags: ["ci", "unit"],
				success: false,
			},
		}
		const auditEvent = {
			id: "audit_123",
			userId: "user_123",
			timestamp: "2026-06-14T18:00:00.000Z",
			...input,
		}
		const result = { auditEvent }

		expect(parseAppendAuditEventInput(input)).toEqual({ ok: true, value: input })
		expect(isAppendAuditEventInput(input)).toBe(true)
		expect(parseAuditEventRecord(auditEvent)).toEqual({ ok: true, value: auditEvent })
		expect(isAuditEventRecord(auditEvent)).toBe(true)
		expect(parseAppendAuditEventResult(result)).toEqual({ ok: true, value: result })
		expect(isAppendAuditEventResult(result)).toBe(true)
	})

	it("defaults append audit event metadata to an empty object", () => {
		expect(parseAppendAuditEventInput({ type: "run.created" })).toEqual({
			ok: true,
			value: {
				type: "run.created",
				metadata: {},
			},
		})
	})

	it("rejects invalid append audit event input", () => {
		const result = parseAppendAuditEventInput({
			type: "unknown",
			projectId: "run_123",
			hostId: "proj_123",
			agentId: "host_123",
			grantId: "agent_123",
			runId: "grant_123",
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("VALIDATION_FAILED")
			expect(result.error.details).toEqual({
				issues: [
					{ path: "$.type", message: "Expected a supported audit event type." },
					{ path: "$.projectId", message: "Expected a project ID." },
					{ path: "$.hostId", message: "Expected a host ID." },
					{ path: "$.agentId", message: "Expected an agent ID." },
					{ path: "$.grantId", message: "Expected a grant ID." },
					{ path: "$.runId", message: "Expected a run ID." },
				],
			})
		}
	})
})
