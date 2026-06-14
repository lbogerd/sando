import { describe, expect, it } from "vitest"

import { asId } from "@sando/shared"

import { createMemoryAuditEventRepository } from "./audit-events.js"
import { createHostedApp } from "./index.js"

const userId = asId("user", "user_123")
const timestamp = new Date("2026-06-14T18:00:00.000Z")
const appendBody = {
	type: "command.finished",
	projectId: "proj_123",
	hostId: "host_123",
	agentId: "agent_123",
	grantId: "grant_123",
	runId: "run_123",
	metadata: {
		command: "pnpm test",
		exitCode: 1,
		success: false,
	},
}

describe("audit event API routes", () => {
	it("requires authentication to append an audit event", async () => {
		const app = createHostedApp()

		const response = await app.request("/v1/audit-events", {
			method: "POST",
			body: JSON.stringify(appendBody),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({
			error: {
				code: "UNAUTHORIZED",
				message: "Authentication required.",
			},
		})
	})

	it("appends timestamped audit events for the current user", async () => {
		const app = createHostedApp({
			auditEventRepository: createMemoryAuditEventRepository({ generateId: () => "one" }),
			currentUser: () => ({ userId }),
			now: () => timestamp,
		})

		const response = await app.request("/v1/audit-events", {
			method: "POST",
			body: JSON.stringify(appendBody),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(201)
		expect(await response.json()).toEqual({
			auditEvent: {
				id: "audit_one",
				type: "command.finished",
				userId: "user_123",
				projectId: "proj_123",
				hostId: "host_123",
				agentId: "agent_123",
				grantId: "grant_123",
				runId: "run_123",
				timestamp: "2026-06-14T18:00:00.000Z",
				metadata: {
					command: "pnpm test",
					exitCode: 1,
					success: false,
				},
			},
		})
	})

	it("defaults omitted metadata to an empty object", async () => {
		const app = createHostedApp({
			auditEventRepository: createMemoryAuditEventRepository({ generateId: () => "one" }),
			currentUser: () => ({ userId }),
			now: () => timestamp,
		})

		const response = await app.request("/v1/audit-events", {
			method: "POST",
			body: JSON.stringify({ type: "run.created" }),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(201)
		expect(await response.json()).toEqual({
			auditEvent: {
				id: "audit_one",
				type: "run.created",
				userId: "user_123",
				timestamp: "2026-06-14T18:00:00.000Z",
				metadata: {},
			},
		})
	})

	it("returns validation errors for invalid audit event bodies", async () => {
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => timestamp,
		})

		const response = await app.request("/v1/audit-events", {
			method: "POST",
			body: JSON.stringify({
				type: "unknown",
				projectId: "run_123",
				hostId: "proj_123",
				agentId: "host_123",
				grantId: "agent_123",
				runId: "grant_123",
			}),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: {
				code: "VALIDATION_FAILED",
				message: "Invalid append audit event input.",
				details: {
					issues: [
						{ path: "$.type", message: "Expected a supported audit event type." },
						{ path: "$.projectId", message: "Expected a project ID." },
						{ path: "$.hostId", message: "Expected a host ID." },
						{ path: "$.agentId", message: "Expected an agent ID." },
						{ path: "$.grantId", message: "Expected a grant ID." },
						{ path: "$.runId", message: "Expected a run ID." },
					],
				},
			},
		})
	})
})
