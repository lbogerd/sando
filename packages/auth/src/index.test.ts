import { describe, expect, it } from "vitest"

import {
	authAppName,
	authBasePath,
	createSandoAuthOptions,
	sandoAuthOptionsFromEnv,
	type AuthDatabase,
} from "./index.js"

describe("sando auth configuration", () => {
	it("enables Better Auth email login with bearer auth", () => {
		const database = {} as AuthDatabase

		const options = createSandoAuthOptions({
			database,
			secret: "test-secret",
			baseURL: "https://sando.example",
			trustedOrigins: ["https://app.sando.example"],
		})

		expect(options).toMatchObject({
			appName: authAppName,
			basePath: authBasePath,
			database,
			secret: "test-secret",
			baseURL: "https://sando.example",
			trustedOrigins: ["https://app.sando.example"],
		})
		const plugins = options.plugins ?? []

		expect(plugins.map((plugin) => plugin.id)).toEqual(["anonymous", "bearer"])
		expect(options.emailAndPassword).toEqual({
			enabled: true,
			requireEmailVerification: false,
		})
	})

	it("reads hosted auth options from environment values", () => {
		expect(
			sandoAuthOptionsFromEnv({
				BETTER_AUTH_SECRET: "super-secret",
				BETTER_AUTH_URL: "https://api.sando.example",
				SANDO_AUTH_TRUSTED_ORIGINS: " https://app.sando.example,https://cli.sando.example ",
			}),
		).toEqual({
			secret: "super-secret",
			baseURL: "https://api.sando.example",
			trustedOrigins: ["https://app.sando.example", "https://cli.sando.example"],
		})
	})

	it("omits trusted origins when the environment value is empty", () => {
		expect(
			sandoAuthOptionsFromEnv({
				SANDO_AUTH_TRUSTED_ORIGINS: " , ",
			}),
		).toEqual({})
	})
})
