import { describe, expect, it } from "vitest"

import { apiServiceName, apiVersion, createHostedApp } from "./index.js"

const fixedNow = new Date("2026-06-14T17:30:00.000Z")

describe("hosted API app", () => {
	it("exposes root service metadata", async () => {
		const app = createHostedApp()

		const response = await app.request("/")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			service: apiServiceName,
			version: apiVersion,
			status: "ok",
		})
	})

	it("exposes health information with an injectable clock", async () => {
		const app = createHostedApp({ now: () => fixedNow })

		const response = await app.request("/health")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			ok: true,
			service: apiServiceName,
			checkedAt: "2026-06-14T17:30:00.000Z",
		})
	})

	it("exposes versioned control-plane status metadata", async () => {
		const app = createHostedApp()

		const response = await app.request("/v1/status")
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			service: "sandhost-control-plane",
			version: apiVersion,
			status: "ok",
			metadata: {
				policy: {
					version: 1,
					runtimes: ["podman", "docker", "kubernetes"],
					networks: ["none", "default"],
				},
				runCommand: {
					defaults: {
						template: "node-ts",
						network: "none",
						timeoutSeconds: 600,
					},
				},
			},
		})
	})

	it("returns JSON for unknown routes", async () => {
		const app = createHostedApp()

		const response = await app.request("/missing")

		expect(response.status).toBe(404)
		expect(await response.json()).toEqual({
			error: {
				code: "NOT_FOUND",
				message: "Route not found.",
			},
		})
	})
})
