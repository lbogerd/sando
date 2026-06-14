import { describe, expect, it } from "vitest"

import { asId } from "@sando/shared"

import { createHostRoutes, createMemoryHostRepository } from "./hosts.js"
import { createHostedApp } from "./index.js"

const firstSeenAt = new Date("2026-06-14T17:30:00.000Z")
const secondSeenAt = new Date("2026-06-14T18:00:00.000Z")
const userId = asId("user", "user_123")
const registerBody = {
	name: "WSL dev box",
	platform: "linux-wsl",
	runtime: "podman",
	fingerprint: "wsl:ubuntu:machine-id",
}

describe("host API routes", () => {
	it("requires authentication to register a host", async () => {
		const app = createHostedApp()

		const response = await app.request("/v1/hosts/register", {
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

	it("registers hosts and refreshes last seen time for existing fingerprints", async () => {
		let now = firstSeenAt
		const repository = createMemoryHostRepository({ generateId: () => "one" })
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			hostRepository: repository,
			now: () => now,
		})

		const first = await app.request("/v1/hosts/register", {
			method: "POST",
			body: JSON.stringify(registerBody),
			headers: { "content-type": "application/json" },
		})
		now = secondSeenAt
		const second = await app.request("/v1/hosts/register", {
			method: "POST",
			body: JSON.stringify(registerBody),
			headers: { "content-type": "application/json" },
		})

		expect(first.status).toBe(201)
		expect(await first.json()).toEqual({
			host: {
				id: "host_one",
				userId: "user_123",
				name: "WSL dev box",
				platform: "linux-wsl",
				runtime: "podman",
				fingerprint: "wsl:ubuntu:machine-id",
				createdAt: "2026-06-14T17:30:00.000Z",
				lastSeenAt: "2026-06-14T17:30:00.000Z",
			},
			created: true,
		})
		expect(second.status).toBe(200)
		expect(await second.json()).toEqual({
			host: {
				id: "host_one",
				userId: "user_123",
				name: "WSL dev box",
				platform: "linux-wsl",
				runtime: "podman",
				fingerprint: "wsl:ubuntu:machine-id",
				createdAt: "2026-06-14T17:30:00.000Z",
				lastSeenAt: "2026-06-14T18:00:00.000Z",
			},
			created: false,
		})
	})

	it("returns validation errors for invalid registration bodies", async () => {
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => firstSeenAt,
		})

		const response = await app.request("/v1/hosts/register", {
			method: "POST",
			body: JSON.stringify({
				name: "",
				platform: "macos",
				runtime: "vm",
				fingerprint: "",
			}),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: {
				code: "VALIDATION_FAILED",
				message: "Invalid register host input.",
				details: {
					issues: [
						{ path: "$.name", message: "Expected a non-empty string." },
						{ path: "$.platform", message: "Expected a supported host platform." },
						{ path: "$.runtime", message: "Expected a supported sandbox runtime." },
						{ path: "$.fingerprint", message: "Expected a non-empty string." },
					],
				},
			},
		})
	})

	it("can mount host routes as a standalone Hono sub-app", async () => {
		const routes = createHostRoutes({
			currentUser: () => ({ userId }),
			hostRepository: createMemoryHostRepository({ generateId: () => "one" }),
			now: () => firstSeenAt,
		})

		const response = await routes.request("/hosts/register", {
			method: "POST",
			body: JSON.stringify(registerBody),
			headers: { "content-type": "application/json" },
		})

		expect(response.status).toBe(201)
	})
})
