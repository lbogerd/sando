import { defineConfig } from "drizzle-kit"

const databaseUrl = process.env.DATABASE_URL

if (databaseUrl === undefined || databaseUrl.length === 0) {
	throw new Error("DATABASE_URL is required for drizzle-kit.")
}

export default defineConfig({
	dialect: "postgresql",
	dbCredentials: {
		url: databaseUrl,
	},
	out: "./packages/db/drizzle",
	schema: "./packages/db/src/schema.ts",
	schemaFilter: ["sando"],
})
