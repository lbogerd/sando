import { describe, expect, it } from "vitest"

import { createHostedApp } from "./index.js"
import { createMemoryHostedLoginRepository } from "./login.js"

const requestedAt = new Date("2026-06-14T17:30:00.000Z")
const completedAt = new Date("2026-06-14T17:31:00.000Z")
const expiredAt = new Date("2026-06-14T17:41:00.000Z")

describe("hosted login routes", () => {
	it("starts a browser login ticket and exposes the hosted page", async () => {
		const app = createHostedApp({
			loginRepository: createMemoryHostedLoginRepository({ generateId: () => "one" }),
			now: () => requestedAt,
		})

		const start = await app.request("/v1/login/start", {
			method: "POST",
			body: "{}",
			headers: { "content-type": "application/json" },
		})
		const body = await start.json()
		const page = await app.request("/v1/login/login_one")

		expect(start.status).toBe(201)
		expect(body).toEqual({
			login: {
				id: "login_one",
				status: "pending",
				createdAt: "2026-06-14T17:30:00.000Z",
				expiresAt: "2026-06-14T17:40:00.000Z",
			},
			loginUrl: "http://localhost/v1/login/login_one",
			pollUrl: "http://localhost/v1/login/login_one/token",
		})
		expect(page.status).toBe(200)
		expect(await page.text()).toContain("Sign in to sando.")
	})

	it("completes a login ticket through Better Auth email sign in", async () => {
		let now = requestedAt
		const app = createHostedApp({
			auth: {
				handler: async () => Response.json({ ok: true }),
				api: {
					signInEmail: async (input: { readonly body: Record<string, unknown> }) => {
						expect(input.body).toMatchObject({
							email: "user@example.test",
							password: "correct horse battery staple",
							rememberMe: true,
						})

						return {
							status: 200,
							response: {
								token: "session_123",
								user: { id: "user_123" },
							},
						}
					},
				},
			},
			loginRepository: createMemoryHostedLoginRepository({ generateId: () => "one" }),
			now: () => now,
		})

		await app.request("/v1/login/start", { method: "POST" })
		const pending = await app.request("/v1/login/login_one/token")
		now = completedAt
		const complete = await app.request("/v1/login/login_one/complete", {
			method: "POST",
			body: new URLSearchParams({
				mode: "sign-in",
				email: "user@example.test",
				password: "correct horse battery staple",
			}),
			headers: { "content-type": "application/x-www-form-urlencoded" },
		})
		const poll = await app.request("/v1/login/login_one/token")
		now = expiredAt
		const expired = await app.request("/v1/login/login_one/token")

		expect(pending.status).toBe(202)
		expect(await pending.json()).toEqual({
			status: "pending",
			expiresAt: "2026-06-14T17:40:00.000Z",
		})
		expect(complete.status).toBe(200)
		expect(await complete.text()).toContain("Login complete. You can return to Codex.")
		expect(poll.status).toBe(200)
		expect(await poll.json()).toEqual({
			status: "completed",
			token: "session_123",
			user: { id: "user_123" },
		})
		expect(expired.status).toBe(410)
	})

	it("returns expired login tickets without completing them", async () => {
		let now = requestedAt
		const app = createHostedApp({
			auth: {
				handler: async () => Response.json({ ok: true }),
				api: {
					signUpEmail: async () => {
						throw new Error("should not sign up expired tickets")
					},
				},
			},
			loginRepository: createMemoryHostedLoginRepository({ generateId: () => "one" }),
			now: () => now,
		})

		await app.request("/v1/login/start", { method: "POST" })
		now = expiredAt
		const poll = await app.request("/v1/login/login_one/token")
		const complete = await app.request("/v1/login/login_one/complete", {
			method: "POST",
			body: new URLSearchParams({
				mode: "sign-up",
				name: "User",
				email: "user@example.test",
				password: "correct horse battery staple",
			}),
			headers: { "content-type": "application/x-www-form-urlencoded" },
		})

		expect(poll.status).toBe(410)
		expect(await poll.json()).toEqual({
			error: {
				code: "UNAUTHORIZED",
				message: "Login request expired.",
			},
		})
		expect(complete.status).toBe(410)
		expect(await complete.text()).toContain("Login request expired.")
	})
})
