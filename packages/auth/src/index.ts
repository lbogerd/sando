import { drizzleAdapter, type DB as DrizzleDatabase } from "@better-auth/drizzle-adapter"
import { betterAuth, type BetterAuthOptions } from "better-auth"

import { betterAuthSchema } from "@sando/db"

export const authBasePath = "/api/auth"
export const authAppName = "sandhost"
export const defaultMinimumPasswordLength = 8
export const defaultMaximumPasswordLength = 128

export type AuthDatabase = NonNullable<BetterAuthOptions["database"]>
export type SandhostAuth = ReturnType<typeof betterAuth>

export type SandhostAuthOptions = {
	readonly database: AuthDatabase
	readonly baseURL?: string
	readonly secret?: string
	readonly trustedOrigins?: readonly string[]
}

export type SandhostAuthEnvironment = {
	readonly BETTER_AUTH_SECRET?: string
	readonly BETTER_AUTH_URL?: string
	readonly SANDHOST_AUTH_TRUSTED_ORIGINS?: string
}

export function createSandhostAuthOptions(input: SandhostAuthOptions): BetterAuthOptions {
	return {
		appName: authAppName,
		basePath: authBasePath,
		database: input.database,
		...(input.secret === undefined ? {} : { secret: input.secret }),
		...(input.baseURL === undefined ? {} : { baseURL: input.baseURL }),
		...(input.trustedOrigins === undefined ? {} : { trustedOrigins: [...input.trustedOrigins] }),
		emailAndPassword: {
			enabled: true,
			minPasswordLength: defaultMinimumPasswordLength,
			maxPasswordLength: defaultMaximumPasswordLength,
			requireEmailVerification: false,
			autoSignIn: true,
		},
	}
}

export function createSandhostAuth(input: SandhostAuthOptions): SandhostAuth {
	return betterAuth(createSandhostAuthOptions(input))
}

export function createSandhostDrizzleAuth(input: {
	readonly db: DrizzleDatabase
	readonly baseURL?: string
	readonly secret?: string
	readonly trustedOrigins?: readonly string[]
}): SandhostAuth {
	return createSandhostAuth({
		database: drizzleAdapter(input.db, {
			provider: "pg",
			schema: betterAuthSchema,
		}),
		...(input.baseURL === undefined ? {} : { baseURL: input.baseURL }),
		...(input.secret === undefined ? {} : { secret: input.secret }),
		...(input.trustedOrigins === undefined ? {} : { trustedOrigins: input.trustedOrigins }),
	})
}

export function sandhostAuthOptionsFromEnv(
	env: SandhostAuthEnvironment,
): Omit<SandhostAuthOptions, "database"> {
	return {
		...(env.BETTER_AUTH_SECRET === undefined ? {} : { secret: env.BETTER_AUTH_SECRET }),
		...(env.BETTER_AUTH_URL === undefined ? {} : { baseURL: env.BETTER_AUTH_URL }),
		...trustedOriginsFromEnv(env.SANDHOST_AUTH_TRUSTED_ORIGINS),
	}
}

function trustedOriginsFromEnv(
	value: string | undefined,
): Pick<SandhostAuthOptions, "trustedOrigins"> | Record<string, never> {
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
