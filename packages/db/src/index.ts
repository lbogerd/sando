import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema.js"

export * from "./schema.js"

export function createPostgresJsDatabase(input: {
	readonly databaseUrl: string
	readonly max?: number
}) {
	const client = postgres(input.databaseUrl, {
		max: input.max ?? 10,
	})

	return drizzle(client, {
		schema,
	})
}

export async function ensureSandoDatabaseSchema(input: {
	readonly databaseUrl: string
}): Promise<void> {
	const client = postgres(input.databaseUrl, {
		max: 1,
	})

	try {
		await client.unsafe(`create schema if not exists "${schema.databaseSchemaName}"`)
	} finally {
		await client.end({ timeout: 5 })
	}
}

export async function assertSandoDatabaseReady(input: {
	readonly databaseUrl: string
}): Promise<void> {
	const client = postgres(input.databaseUrl, {
		max: 1,
	})

	try {
		const rows = await client<{ tablename: string }[]>`
			select tablename
			from pg_tables
			where schemaname = ${schema.databaseSchemaName}
				and tablename in ('user', 'session')
		`
		const tables = new Set(rows.map((row) => row.tablename))

		if (!tables.has("user") || !tables.has("session")) {
			throw new Error("Sando database schema is missing Better Auth tables.")
		}
	} finally {
		await client.end({ timeout: 5 })
	}
}
