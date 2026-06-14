import { describe, expect, it } from "vitest"

import { asId } from "@sando/shared"

import { createHostedApp } from "./index.js"
import { createMemoryProjectRepository } from "./projects.js"

const fixedNow = new Date("2026-06-14T17:30:00.000Z")
const userId = asId("user", "user_123")
const otherUserId = asId("user", "user_456")
const registerBody = {
	name: "Fixture",
	localFingerprint: "fingerprint-1",
	policyId: "policy_default",
}

describe("project API routes", () => {
	it("requires authentication to register a project", async () => {
		const app = createHostedApp()

		const response = await app.request("/v1/projects/register", {
			method: "POST",
			body: JSON.stringify(registerBody),
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

	it("registers, idempotently reuses, and gets projects for the current user", async () => {
		const repository = createMemoryProjectRepository({ generateId: () => "one" })
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => fixedNow,
			projectRepository: repository,
		})

		const first = await app.request("/v1/projects/register", {
			method: "POST",
			body: JSON.stringify(registerBody),
			headers: { "content-type": "application/json" },
		})
		const second = await app.request("/v1/projects/register", {
			method: "POST",
			body: JSON.stringify(registerBody),
			headers: { "content-type": "application/json" },
		})
		const fetched = await app.request("/v1/projects/proj_one")

		const project = {
			id: "proj_one",
			userId: "user_123",
			name: "Fixture",
			localFingerprint: "fingerprint-1",
			policyId: "policy_default",
			createdAt: "2026-06-14T17:30:00.000Z",
		}

		expect(first.status).toBe(201)
		expect(await first.json()).toEqual({ project, created: true })
		expect(second.status).toBe(200)
		expect(await second.json()).toEqual({ project, created: false })
		expect(fetched.status).toBe(200)
		expect(await fetched.json()).toEqual({ project })
	})

	it("rejects malformed project IDs", async () => {
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => fixedNow,
		})

		const response = await app.request("/v1/projects/not-a-project")

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: {
				code: "VALIDATION_FAILED",
				message: "Invalid project ID.",
				details: {
					issues: [{ path: "$.projectId", message: "Expected a project ID." }],
				},
			},
		})
	})

	it("scopes project reads to the current user", async () => {
		const repository = createMemoryProjectRepository({ generateId: () => "one" })
		const ownerApp = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => fixedNow,
			projectRepository: repository,
		})
		const otherApp = createHostedApp({
			currentUser: () => ({ userId: otherUserId }),
			now: () => fixedNow,
			projectRepository: repository,
		})

		await ownerApp.request("/v1/projects/register", {
			method: "POST",
			body: JSON.stringify(registerBody),
			headers: { "content-type": "application/json" },
		})

		const response = await otherApp.request("/v1/projects/proj_one")

		expect(response.status).toBe(404)
		expect(await response.json()).toEqual({
			error: {
				code: "NOT_FOUND",
				message: "Project not found.",
			},
		})
	})

	it("returns validation errors for invalid registration bodies", async () => {
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => fixedNow,
		})

		const response = await app.request("/v1/projects/register", {
			method: "POST",
			body: JSON.stringify({
				name: "",
				localFingerprint: "",
				policyId: "proj_123",
			}),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: {
				code: "VALIDATION_FAILED",
				message: "Invalid register project input.",
				details: {
					issues: [
						{ path: "$.name", message: "Expected a non-empty string." },
						{ path: "$.localFingerprint", message: "Expected a non-empty string." },
						{ path: "$.policyId", message: "Expected a policy ID." },
					],
				},
			},
		})
	})
})
