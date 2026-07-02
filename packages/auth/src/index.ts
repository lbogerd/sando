import { drizzleAdapter, type DB as DrizzleDatabase } from "@better-auth/drizzle-adapter"
import { betterAuth, type BetterAuthOptions } from "better-auth"
import { anonymous, bearer } from "better-auth/plugins"

import { betterAuthSchema } from "@sando/db"

export const authBasePath = "/api/auth"
export const authAppName = "sando"

export type AuthDatabase = NonNullable<BetterAuthOptions["database"]>
export type SandoAuth = ReturnType<typeof betterAuth>

export type SandoAuthOptions = {
	readonly database: AuthDatabase
	readonly baseURL?: string
	readonly secret?: string
	readonly trustedOrigins?: readonly string[]
}

export type SandoAuthEnvironment = {
	readonly BETTER_AUTH_SECRET?: string
	readonly BETTER_AUTH_URL?: string
	readonly SANDO_AUTH_TRUSTED_ORIGINS?: string
}

export function createSandoAuthOptions(input: SandoAuthOptions): BetterAuthOptions {
	return {
		appName: authAppName,
		basePath: authBasePath,
		database: input.database,
		...(input.secret === undefined ? {} : { secret: input.secret }),
		...(input.baseURL === undefined ? {} : { baseURL: input.baseURL }),
		...(input.trustedOrigins === undefined ? {} : { trustedOrigins: [...input.trustedOrigins] }),
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: false,
		},
		plugins: [anonymous(), bearer()],
	}
}

export function createSandoAuth(input: SandoAuthOptions): SandoAuth {
	return betterAuth(createSandoAuthOptions(input))
}

export function createSandoDrizzleAuth(input: {
	readonly db: DrizzleDatabase
	readonly baseURL?: string
	readonly secret?: string
	readonly trustedOrigins?: readonly string[]
}): SandoAuth {
	return createSandoAuth({
		database: drizzleAdapter(input.db, {
			provider: "pg",
			schema: betterAuthSchema,
		}),
		...(input.baseURL === undefined ? {} : { baseURL: input.baseURL }),
		...(input.secret === undefined ? {} : { secret: input.secret }),
		...(input.trustedOrigins === undefined ? {} : { trustedOrigins: input.trustedOrigins }),
	})
}

export function sandoAuthOptionsFromEnv(
	env: SandoAuthEnvironment,
): Omit<SandoAuthOptions, "database"> {
	return {
		...(env.BETTER_AUTH_SECRET === undefined ? {} : { secret: env.BETTER_AUTH_SECRET }),
		...(env.BETTER_AUTH_URL === undefined ? {} : { baseURL: env.BETTER_AUTH_URL }),
		...trustedOriginsFromEnv(env.SANDO_AUTH_TRUSTED_ORIGINS),
	}
}

function trustedOriginsFromEnv(
	value: string | undefined,
): Pick<SandoAuthOptions, "trustedOrigins"> | Record<string, never> {
	const trustedOrigins = splitTrustedOrigins(value)

	return trustedOrigins === undefined ? {} : { trustedOrigins }
}

function splitTrustedOrigins(value: string | undefined): string[] | undefined {
	if (value === undefined) {
		return undefined
	}

	const origins = value
		.split(",")
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0)

	return origins.length === 0 ? undefined : origins
}
