import { describe, expect, it } from "vitest"

import { asId, runProjectCommandHash, type AuditEventRecord } from "@sando/shared"

import { type AppendAuditEventCommand, type AuditEventRepository } from "./audit-events.js"
import { createMemoryGrantRepository } from "./grants.js"
import { createHostedApp } from "./index.js"

const userId = asId("user", "user_123")
const requestedAt = new Date("2026-06-14T17:30:00.000Z")
const approvedAt = new Date("2026-06-14T17:31:00.000Z")
const expiredAt = new Date("2026-06-14T18:02:00.000Z")

describe("grant API routes", () => {
	it("creates a hosted approval flow for the first Codex run", async () => {
		const audit = recordingAuditRepository()
		const app = createHostedApp({
			auditEventRepository: audit.repository,
			currentUser: () => ({ userId }),
			grantRepository: createMemoryGrantRepository({ generateId: idSequence("one") }),
			now: () => requestedAt,
		})

		const response = await app.request("/v1/grants/request", jsonRequest(requestBody("pnpm test")))
		const body = await response.json()

		expect(response.status).toBe(201)
		expect(body).toMatchObject({
			approvalUrl: "http://localhost/v1/grants/grant_one/approval",
			created: true,
			grant: {
				id: "grant_one",
				status: "pending",
				projectId: "proj_123",
				hostId: "host_123",
				agentId: "agent_123",
				capabilities: ["sandbox.run_project_command"],
				constraints: {
					command: "pnpm test",
					network: "none",
					runtime: "podman",
					template: "node-ts",
					timeoutSeconds: 120,
					maxTimeoutSeconds: 600,
				},
			},
		})

		const approval = await app.request("/v1/grants/grant_one/approval")
		const html = await approval.text()

		expect(approval.status).toBe(200)
		expect(html).toContain("Codex wants to run a project command")
		expect(html).toContain("Approve once")
		expect(html).toContain("Approve for 30 minutes")
		expect(html).toContain("Deny")
		expect(audit.events.map((event) => event.type)).toEqual(["grant.requested"])
	})

	it("approve once permits only the approved command hash", async () => {
		let now = requestedAt
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			grantRepository: createMemoryGrantRepository({ generateId: idSequence("one") }),
			now: () => now,
		})

		await app.request("/v1/grants/request", jsonRequest(requestBody("pnpm test")))
		now = approvedAt
		const approve = await app.request(
			"/v1/grants/grant_one/approve",
			jsonRequest({ scope: "one_shot" }),
		)
		const deniedHash = await app.request(
			"/v1/grants/authorize",
			jsonRequest({ ...requestBody("pnpm build"), grantId: "grant_one" }),
		)
		const approvedHash = await app.request(
			"/v1/grants/authorize",
			jsonRequest({ ...requestBody("pnpm test"), grantId: "grant_one" }),
		)
		const replay = await app.request(
			"/v1/grants/authorize",
			jsonRequest({ ...requestBody("pnpm test"), grantId: "grant_one" }),
		)

		expect(approve.status).toBe(200)
		expect(await approve.json()).toMatchObject({
			grant: {
				id: "grant_one",
				scope: "one_shot",
				status: "approved",
			},
		})
		expect(deniedHash.status).toBe(403)
		expect(await deniedHash.json()).toMatchObject({
			error: {
				code: "GRANT_REQUIRED",
				message: "Grant constraints do not permit this command.",
			},
		})
		expect(approvedHash.status).toBe(200)
		expect(await approvedHash.json()).toMatchObject({
			authorized: true,
			grant: {
				id: "grant_one",
				scope: "one_shot",
			},
		})
		expect(replay.status).toBe(403)
		expect(await replay.json()).toMatchObject({
			error: {
				code: "GRANT_REQUIRED",
				message: "Grant is not approved.",
			},
		})
	})

	it("approve for 30 minutes permits compatible commands for the same project host and agent", async () => {
		let now = requestedAt
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			grantRepository: createMemoryGrantRepository({ generateId: idSequence("one", "two") }),
			now: () => now,
		})

		await app.request("/v1/grants/request", jsonRequest(requestBody("pnpm test")))
		now = approvedAt
		await app.request("/v1/grants/grant_one/approve", jsonRequest({ scope: "project_window" }))

		const compatible = await app.request(
			"/v1/grants/authorize",
			jsonRequest(requestBody("pnpm build")),
		)
		const reused = await app.request("/v1/grants/request", jsonRequest(requestBody("pnpm lint")))
		const incompatibleHost = await app.request(
			"/v1/grants/authorize",
			jsonRequest({
				...requestBody("pnpm build"),
				hostId: "host_other",
			}),
		)

		expect(compatible.status).toBe(200)
		expect(await compatible.json()).toMatchObject({
			authorized: true,
			grant: {
				id: "grant_one",
				scope: "project_window",
			},
		})
		expect(reused.status).toBe(200)
		expect(await reused.json()).toMatchObject({
			created: false,
			grant: {
				id: "grant_one",
				status: "approved",
			},
		})
		expect(incompatibleHost.status).toBe(403)
	})

	it("deny prevents execution", async () => {
		let now = requestedAt
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			grantRepository: createMemoryGrantRepository({ generateId: idSequence("one") }),
			now: () => now,
		})

		await app.request("/v1/grants/request", jsonRequest(requestBody("pnpm test")))
		now = approvedAt
		const deny = await app.request("/v1/grants/grant_one/deny", { method: "POST" })
		const authorize = await app.request(
			"/v1/grants/authorize",
			jsonRequest({ ...requestBody("pnpm test"), grantId: "grant_one" }),
		)

		expect(deny.status).toBe(200)
		expect(await deny.json()).toMatchObject({
			grant: {
				id: "grant_one",
				status: "denied",
			},
		})
		expect(authorize.status).toBe(403)
		expect(await authorize.json()).toMatchObject({
			error: {
				code: "GRANT_DENIED",
				message: "Grant was denied.",
			},
		})
	})

	it("expired grants prevent execution", async () => {
		let now = requestedAt
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			grantRepository: createMemoryGrantRepository({ generateId: idSequence("one") }),
			now: () => now,
		})

		await app.request("/v1/grants/request", jsonRequest(requestBody("pnpm test")))
		now = approvedAt
		await app.request("/v1/grants/grant_one/approve", jsonRequest({ scope: "project_window" }))
		now = expiredAt

		const authorize = await app.request(
			"/v1/grants/authorize",
			jsonRequest({ ...requestBody("pnpm test"), grantId: "grant_one" }),
		)
		const fetched = await app.request("/v1/grants/grant_one")

		expect(authorize.status).toBe(403)
		expect(await authorize.json()).toMatchObject({
			error: {
				code: "GRANT_REQUIRED",
				message: "Grant has expired.",
			},
		})
		expect(await fetched.json()).toMatchObject({
			grant: {
				id: "grant_one",
				status: "expired",
			},
		})
	})

	it("records grant requested, approved, denied, and capability executed audit events", async () => {
		let now = requestedAt
		const audit = recordingAuditRepository()
		const app = createHostedApp({
			auditEventRepository: audit.repository,
			currentUser: () => ({ userId }),
			grantRepository: createMemoryGrantRepository({ generateId: idSequence("one", "two") }),
			now: () => now,
		})

		await app.request("/v1/grants/request", jsonRequest(requestBody("pnpm test")))
		now = approvedAt
		await app.request("/v1/grants/grant_one/approve", jsonRequest({ scope: "one_shot" }))
		await app.request(
			"/v1/grants/authorize",
			jsonRequest({ ...requestBody("pnpm test"), grantId: "grant_one" }),
		)
		await app.request("/v1/grants/request", jsonRequest(requestBody("pnpm build")))
		await app.request("/v1/grants/grant_two/deny", { method: "POST" })

		expect(audit.events.map((event) => event.type)).toEqual([
			"grant.requested",
			"grant.approved",
			"capability.executed",
			"grant.requested",
			"grant.denied",
		])
		expect(audit.events[0]?.metadata).toMatchObject({
			command: "pnpm test",
			commandHash: requestBody("pnpm test").constraints.commandHash,
		})
	})
})

function requestBody(command: string) {
	const constraints = {
		command,
		commandHash: runProjectCommandHash({
			command,
			template: "node-ts",
			runtime: "podman",
			network: "none",
			timeoutSeconds: 120,
		}),
		maxTimeoutSeconds: 600,
		network: "none",
		runtime: "podman",
		template: "node-ts",
		timeoutSeconds: 120,
	}

	return {
		projectId: "proj_123",
		hostId: "host_123",
		agentId: "agent_123",
		capability: "sandbox.run_project_command",
		constraints,
	}
}

function jsonRequest(body: unknown): RequestInit {
	return {
		method: "POST",
		body: JSON.stringify(body),
		headers: { "content-type": "application/json" },
	}
}

function idSequence(...ids: readonly string[]): () => string {
	let index = 0

	return () => ids[index++] ?? `extra_${index}`
}

function recordingAuditRepository(): {
	readonly events: AppendAuditEventCommand[]
	readonly repository: AuditEventRepository
} {
	const events: AppendAuditEventCommand[] = []

	return {
		events,
		repository: {
			appendAuditEvent(input) {
				events.push(input)

				return {
					auditEvent: {
						id: asId("auditEvent", `audit_${events.length}`),
						type: input.type,
						userId: input.userId,
						...(input.projectId === undefined ? {} : { projectId: input.projectId }),
						...(input.hostId === undefined ? {} : { hostId: input.hostId }),
						...(input.agentId === undefined ? {} : { agentId: input.agentId }),
						...(input.grantId === undefined ? {} : { grantId: input.grantId }),
						...(input.runId === undefined ? {} : { runId: input.runId }),
						timestamp: input.now.toISOString(),
						metadata: input.metadata,
					} satisfies AuditEventRecord,
				}
			},
		},
	}
}
