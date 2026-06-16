import { describe, expect, it } from "vitest"

import { authBasePath } from "@sando/auth"

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

	it("exposes Agent Auth discovery metadata", async () => {
		const app = createHostedApp()

		const response = await app.request("/.well-known/agent-configuration")

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			issuer: "http://localhost",
			capabilities: expect.arrayContaining(["sandbox.run_project_command"]),
			grantRequestEndpoint: "http://localhost/v1/grants/request",
			grantAuthorizationEndpoint: "http://localhost/v1/grants/authorize",
		})
	})

	it("exposes versioned control-plane status metadata", async () => {
		const app = createHostedApp()

		const response = await app.request("/v1/status")
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			service: "sando-control-plane",
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

	it("mounts the Better Auth handler for login routes", async () => {
		const app = createHostedApp({
			auth: {
				handler: async (request) =>
					Response.json({
						method: request.method,
						path: new URL(request.url).pathname,
					}),
			},
		})

		const response = await app.request(`${authBasePath}/sign-in/email`, {
			method: "POST",
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			method: "POST",
			path: `${authBasePath}/sign-in/email`,
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
