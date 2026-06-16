import { describe, expect, it } from "vitest"

import { asId } from "@sando/shared"

import { createHostedApp } from "./index.js"

const fixedNow = new Date("2026-06-14T17:30:00.000Z")
const userId = asId("user", "user_123")
const registerBody = {
	hostId: "host_123",
	kind: "codex",
	displayName: "Codex",
}

describe("agent API routes", () => {
	it("requires authentication to register an agent", async () => {
		const app = createHostedApp()

		const response = await app.request("/v1/agents/register", {
			method: "POST",
			body: JSON.stringify(registerBody),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(401)
	})

	it("registers agents and refreshes existing host kind display names", async () => {
		let now = fixedNow
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => now,
		})

		const first = await app.request("/v1/agents/register", {
			method: "POST",
			body: JSON.stringify(registerBody),
			headers: { "content-type": "application/json" },
		})
		now = new Date("2026-06-14T18:00:00.000Z")
		const second = await app.request("/v1/agents/register", {
			method: "POST",
			body: JSON.stringify(registerBody),
			headers: { "content-type": "application/json" },
		})

		expect(first.status).toBe(201)
		expect(await first.json()).toMatchObject({
			agent: {
				id: expect.stringMatching(/^agent_/u),
				userId: "user_123",
				hostId: "host_123",
				kind: "codex",
				displayName: "Codex",
				createdAt: "2026-06-14T17:30:00.000Z",
				lastSeenAt: "2026-06-14T17:30:00.000Z",
			},
			created: true,
		})
		expect(second.status).toBe(200)
		expect(await second.json()).toMatchObject({
			agent: {
				lastSeenAt: "2026-06-14T18:00:00.000Z",
			},
			created: false,
		})
	})

	it("returns validation errors for invalid registration bodies", async () => {
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => fixedNow,
		})

		const response = await app.request("/v1/agents/register", {
			method: "POST",
			body: JSON.stringify({
				hostId: "proj_123",
				kind: "other",
				displayName: "",
			}),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: {
				code: "VALIDATION_FAILED",
				message: "Invalid register agent input.",
				details: {
					issues: [
						{ path: "$.hostId", message: "Expected a host ID." },
						{ path: "$.kind", message: "Expected a supported agent kind." },
						{ path: "$.displayName", message: "Expected a non-empty string." },
					],
				},
			},
		})
	})
})
