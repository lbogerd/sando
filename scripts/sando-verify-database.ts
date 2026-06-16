import { assertSandoDatabaseReady } from "../packages/db/src/index.ts"

const databaseUrl = process.env.DATABASE_URL

if (databaseUrl === undefined || databaseUrl.length === 0) {
	throw new Error("DATABASE_URL is required to verify the Sando database.")
}

await assertSandoDatabaseReady({
	databaseUrl,
})
