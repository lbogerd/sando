import { describe, expect, it } from "vitest"

import { asId } from "@sando/shared"

import { createHostedApp } from "./index.js"
import { createMemoryRunRepository } from "./runs.js"

const userId = asId("user", "user_123")
const otherUserId = asId("user", "user_456")
const finishedAt = new Date("2026-06-14T18:00:00.000Z")
const createRunBody = {
	projectId: "proj_123",
	hostId: "host_123",
	agentId: "agent_123",
	grantId: "grant_123",
	command: "pnpm test",
	template: "node-ts",
	runtime: "podman",
	network: "none",
}

describe("run API routes", () => {
	it("requires authentication to create a run", async () => {
		const app = createHostedApp()

		const response = await app.request("/v1/runs", {
			method: "POST",
			body: JSON.stringify(createRunBody),
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

	it("creates queued run metadata for the current user", async () => {
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => finishedAt,
			runRepository: createMemoryRunRepository({ generateId: () => "one" }),
		})

		const response = await app.request("/v1/runs", {
			method: "POST",
			body: JSON.stringify(createRunBody),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(201)
		expect(await response.json()).toEqual({
			run: {
				id: "run_one",
				userId: "user_123",
				projectId: "proj_123",
				hostId: "host_123",
				agentId: "agent_123",
				grantId: "grant_123",
				command: "pnpm test",
				template: "node-ts",
				runtime: "podman",
				network: "none",
				status: "queued",
			},
		})
	})

	it("returns validation errors for invalid create run bodies", async () => {
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => finishedAt,
		})

		const response = await app.request("/v1/runs", {
			method: "POST",
			body: JSON.stringify({
				projectId: "run_123",
				hostId: "proj_123",
				agentId: "host_123",
				grantId: "agent_123",
				command: "",
				template: "",
				runtime: "vm",
				network: "private",
			}),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: {
				code: "VALIDATION_FAILED",
				message: "Invalid create run input.",
				details: {
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
				},
			},
		})
	})

	it("finishes existing runs for the current user", async () => {
		const runRepository = createMemoryRunRepository({ generateId: () => "one" })
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => finishedAt,
			runRepository,
		})

		await app.request("/v1/runs", {
			method: "POST",
			body: JSON.stringify(createRunBody),
			headers: { "content-type": "application/json" },
		})

		const response = await app.request("/v1/runs/run_one/finish", {
			method: "POST",
			body: JSON.stringify({
				status: "failed",
				exitCode: 1,
				durationMs: 42100,
			}),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			run: {
				id: "run_one",
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
		})
	})

	it("rejects malformed run IDs when finishing runs", async () => {
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => finishedAt,
		})

		const response = await app.request("/v1/runs/not-a-run/finish", {
			method: "POST",
			body: JSON.stringify({
				status: "succeeded",
				exitCode: 0,
				durationMs: 100,
			}),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: {
				code: "VALIDATION_FAILED",
				message: "Invalid run ID.",
				details: {
					issues: [{ path: "$.runId", message: "Expected a run ID." }],
				},
			},
		})
	})

	it("scopes run finishing to the current user", async () => {
		const runRepository = createMemoryRunRepository({ generateId: () => "one" })
		const ownerApp = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => finishedAt,
			runRepository,
		})
		const otherApp = createHostedApp({
			currentUser: () => ({ userId: otherUserId }),
			now: () => finishedAt,
			runRepository,
		})

		await ownerApp.request("/v1/runs", {
			method: "POST",
			body: JSON.stringify(createRunBody),
			headers: { "content-type": "application/json" },
		})

		const response = await otherApp.request("/v1/runs/run_one/finish", {
			method: "POST",
			body: JSON.stringify({
				status: "succeeded",
				exitCode: 0,
				durationMs: 100,
			}),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(404)
		expect(await response.json()).toEqual({
			error: {
				code: "NOT_FOUND",
				message: "Run not found.",
			},
		})
	})

	it("returns validation errors for invalid finish run bodies", async () => {
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => finishedAt,
		})

		const response = await app.request("/v1/runs/run_one/finish", {
			method: "POST",
			body: JSON.stringify({
				status: "queued",
				exitCode: -1,
				durationMs: -1,
			}),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: {
				code: "VALIDATION_FAILED",
				message: "Invalid finish run input.",
				details: {
					issues: [
						{ path: "$.status", message: "Expected a terminal run status." },
						{ path: "$.exitCode", message: "Expected null or a non-negative integer." },
						{ path: "$.durationMs", message: "Expected a non-negative integer." },
					],
				},
			},
		})
	})
})
