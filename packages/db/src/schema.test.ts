import { getTableColumns } from "drizzle-orm"
import { getTableConfig } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"

import {
	account,
	agentKindEnum,
	auditEventTypeEnum,
	betterAuthSchema,
	createdAtColumn,
	databaseSchemaName,
	grantScopeEnum,
	grantStatusEnum,
	host,
	hostPlatformEnum,
	idColumn,
	idColumnLength,
	metadataJsonColumn,
	networkModeEnum,
	optionalTimestampColumn,
	project,
	requiredTimestampColumn,
	runStatusEnum,
	sandboxRuntimeEnum,
	sandhostSchema,
	session,
	user,
	verification,
} from "./index.js"

describe("database schema foundation", () => {
	it("uses the hosted sandhost Postgres schema", () => {
		expect(databaseSchemaName).toBe("sandhost")
		expect(sandhostSchema.schemaName).toBe("sandhost")
	})

	it("defines native enum values for hosted metadata", () => {
		expect(hostPlatformEnum.enumValues).toEqual(["linux-wsl"])
		expect(agentKindEnum.enumValues).toEqual(["codex"])
		expect(grantScopeEnum.enumValues).toEqual(["one_shot", "project_window"])
		expect(grantStatusEnum.enumValues).toEqual([
			"pending",
			"approved",
			"denied",
			"expired",
			"revoked",
		])
		expect(runStatusEnum.enumValues).toEqual([
			"queued",
			"running",
			"succeeded",
			"failed",
			"cancelled",
			"timed_out",
		])
		expect(auditEventTypeEnum.enumValues).toContain("artifact.uploaded")
		expect(networkModeEnum.enumValues).toEqual(["none", "default"])
		expect(sandboxRuntimeEnum.enumValues).toEqual(["podman", "docker", "kubernetes"])
	})

	it("keeps enum definitions inside the sandhost schema", () => {
		expect(hostPlatformEnum.schema).toBe("sandhost")
		expect(agentKindEnum.schema).toBe("sandhost")
		expect(grantScopeEnum.schema).toBe("sandhost")
		expect(grantStatusEnum.schema).toBe("sandhost")
		expect(runStatusEnum.schema).toBe("sandhost")
		expect(auditEventTypeEnum.schema).toBe("sandhost")
		expect(networkModeEnum.schema).toBe("sandhost")
		expect(sandboxRuntimeEnum.schema).toBe("sandhost")
	})

	it("provides reusable column builders with DB defaults", () => {
		const probeTable = sandhostSchema.table("schema_probe", {
			id: idColumn().primaryKey(),
			createdAt: createdAtColumn(),
			startedAt: optionalTimestampColumn("started_at"),
			finishedAt: requiredTimestampColumn("finished_at"),
			metadata: metadataJsonColumn(),
		})
		const columns = getTableColumns(probeTable)

		expect(columns.id.getSQLType()).toBe(`varchar(${idColumnLength})`)
		expect(columns.id.primary).toBe(true)
		expect(columns.createdAt.getSQLType()).toBe("timestamp with time zone")
		expect(columns.createdAt.notNull).toBe(true)
		expect(columns.createdAt.hasDefault).toBe(true)
		expect(columns.startedAt.notNull).toBe(false)
		expect(columns.finishedAt.notNull).toBe(true)
		expect(columns.metadata.getSQLType()).toBe("jsonb")
		expect(columns.metadata.notNull).toBe(true)
	})

	it("defines the Better Auth core table map", () => {
		expect(betterAuthSchema).toEqual({
			user,
			session,
			account,
			verification,
		})
	})

	it("maps Better Auth core fields to sandhost schema tables", () => {
		const userColumns = getTableColumns(user)
		const sessionColumns = getTableColumns(session)
		const accountColumns = getTableColumns(account)
		const verificationColumns = getTableColumns(verification)

		expect(userColumns.id.primary).toBe(true)
		expect(userColumns.email.notNull).toBe(true)
		expect(userColumns.emailVerified.getSQLType()).toBe("boolean")
		expect(userColumns.createdAt.getSQLType()).toBe("timestamp with time zone")
		expect(sessionColumns.token.notNull).toBe(true)
		expect(sessionColumns.expiresAt.getSQLType()).toBe("timestamp with time zone")
		expect(sessionColumns.userId.notNull).toBe(true)
		expect(accountColumns.providerId.notNull).toBe(true)
		expect(accountColumns.password.getSQLType()).toBe("text")
		expect(verificationColumns.identifier.notNull).toBe(true)
		expect(verificationColumns.value.notNull).toBe(true)
		expect(verificationColumns.expiresAt.notNull).toBe(true)
	})

	it("defines the Project metadata table", () => {
		const columns = getTableColumns(project)
		const config = getTableConfig(project)

		expect(config.name).toBe("project")
		expect(config.schema).toBe("sandhost")
		expect(columns.id.primary).toBe(true)
		expect(columns.userId.notNull).toBe(true)
		expect(columns.userId.getSQLType()).toBe(`varchar(${idColumnLength})`)
		expect(columns.name.notNull).toBe(true)
		expect(columns.name.getSQLType()).toBe("text")
		expect(columns.localFingerprint.notNull).toBe(true)
		expect(columns.localFingerprint.getSQLType()).toBe("text")
		expect(columns.policyId.notNull).toBe(true)
		expect(columns.createdAt.notNull).toBe(true)
		expect(columns.createdAt.hasDefault).toBe(true)
		expect(columns.createdAt.getSQLType()).toBe("timestamp with time zone")
	})

	it("keeps project registration unique per user and local fingerprint", () => {
		const config = getTableConfig(project)
		const uniqueIndex = config.indexes.find(
			(index) => index.config.name === "project_user_local_fingerprint_unique",
		)

		expect(uniqueIndex?.config.unique).toBe(true)
		expect(
			uniqueIndex?.config.columns.map((column) => ("name" in column ? column.name : undefined)),
		).toEqual(["user_id", "local_fingerprint"])
	})

	it("defines the Host metadata table", () => {
		const columns = getTableColumns(host)
		const config = getTableConfig(host)

		expect(config.name).toBe("host")
		expect(config.schema).toBe("sandhost")
		expect(columns.id.primary).toBe(true)
		expect(columns.userId.notNull).toBe(true)
		expect(columns.userId.getSQLType()).toBe(`varchar(${idColumnLength})`)
		expect(columns.name.notNull).toBe(true)
		expect(columns.name.getSQLType()).toBe("text")
		expect(columns.platform.notNull).toBe(true)
		expect(columns.platform.getSQLType()).toBe("host_platform")
		expect(hostPlatformEnum.schema).toBe("sandhost")
		expect(hostPlatformEnum.enumValues).toEqual(["linux-wsl"])
		expect(columns.runtime.notNull).toBe(true)
		expect(columns.runtime.getSQLType()).toBe("sandbox_runtime")
		expect(sandboxRuntimeEnum.schema).toBe("sandhost")
		expect(sandboxRuntimeEnum.enumValues).toEqual(["podman", "docker", "kubernetes"])
		expect(columns.fingerprint.notNull).toBe(true)
		expect(columns.fingerprint.getSQLType()).toBe("text")
		expect(columns.createdAt.notNull).toBe(true)
		expect(columns.createdAt.hasDefault).toBe(true)
		expect(columns.lastSeenAt.notNull).toBe(true)
		expect(columns.lastSeenAt.hasDefault).toBe(true)
		expect(columns.lastSeenAt.getSQLType()).toBe("timestamp with time zone")
	})

	it("keeps host registration unique per user and host fingerprint", () => {
		const config = getTableConfig(host)
		const uniqueIndex = config.indexes.find(
			(index) => index.config.name === "host_user_fingerprint_unique",
		)

		expect(uniqueIndex?.config.unique).toBe(true)
		expect(
			uniqueIndex?.config.columns.map((column) => ("name" in column ? column.name : undefined)),
		).toEqual(["user_id", "fingerprint"])
	})
})
