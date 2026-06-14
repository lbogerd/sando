import { describe, expect, it } from "vitest"

import {
	authAppName,
	authBasePath,
	createSandhostAuthOptions,
	defaultMaximumPasswordLength,
	defaultMinimumPasswordLength,
	sandhostAuthOptionsFromEnv,
	type AuthDatabase,
} from "./index.js"

describe("sandhost auth configuration", () => {
	it("enables Better Auth email and password login", () => {
		const database = {} as AuthDatabase

		const options = createSandhostAuthOptions({
			database,
			secret: "test-secret",
			baseURL: "https://sandhost.example",
			trustedOrigins: ["https://app.sandhost.example"],
		})

		expect(options).toMatchObject({
			appName: authAppName,
			basePath: authBasePath,
			database,
			secret: "test-secret",
			baseURL: "https://sandhost.example",
			trustedOrigins: ["https://app.sandhost.example"],
			emailAndPassword: {
				enabled: true,
				minPasswordLength: defaultMinimumPasswordLength,
				maxPasswordLength: defaultMaximumPasswordLength,
				requireEmailVerification: false,
				autoSignIn: true,
			},
		})
	})

	it("reads hosted auth options from environment values", () => {
		expect(
			sandhostAuthOptionsFromEnv({
				BETTER_AUTH_SECRET: "super-secret",
				BETTER_AUTH_URL: "https://api.sandhost.example",
				SANDHOST_AUTH_TRUSTED_ORIGINS:
					" https://app.sandhost.example,https://cli.sandhost.example ",
			}),
		).toEqual({
			secret: "super-secret",
			baseURL: "https://api.sandhost.example",
			trustedOrigins: ["https://app.sandhost.example", "https://cli.sandhost.example"],
		})
	})

	it("omits trusted origins when the environment value is empty", () => {
		expect(
			sandhostAuthOptionsFromEnv({
				SANDHOST_AUTH_TRUSTED_ORIGINS: " , ",
			}),
		).toEqual({})
	})
})
