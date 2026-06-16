import { getTableColumns } from "drizzle-orm"
import { getTableConfig } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"

import {
	account,
	agent,
	agentKindEnum,
	artifact,
	auditEvent,
	auditEventTypeEnum,
	betterAuthSchema,
	createdAtColumn,
	databaseSchemaName,
	grant,
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
	run,
	runStatusEnum,
	sandboxRuntimeEnum,
	sandoSchema,
	session,
	user,
	verification,
} from "./index.js"

describe("database schema foundation", () => {
	it("uses the hosted sando Postgres schema", () => {
		expect(databaseSchemaName).toBe("sando")
		expect(sandoSchema.schemaName).toBe("sando")
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

	it("keeps enum definitions inside the sando schema", () => {
		expect(hostPlatformEnum.schema).toBe("sando")
		expect(agentKindEnum.schema).toBe("sando")
		expect(grantScopeEnum.schema).toBe("sando")
		expect(grantStatusEnum.schema).toBe("sando")
		expect(runStatusEnum.schema).toBe("sando")
		expect(auditEventTypeEnum.schema).toBe("sando")
		expect(networkModeEnum.schema).toBe("sando")
		expect(sandboxRuntimeEnum.schema).toBe("sando")
	})

	it("provides reusable column builders with DB defaults", () => {
		const probeTable = sandoSchema.table("schema_probe", {
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

	it("maps Better Auth core fields to sando schema tables", () => {
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
		expect(config.schema).toBe("sando")
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
		expect(config.schema).toBe("sando")
		expect(columns.id.primary).toBe(true)
		expect(columns.userId.notNull).toBe(true)
		expect(columns.userId.getSQLType()).toBe(`varchar(${idColumnLength})`)
		expect(columns.name.notNull).toBe(true)
		expect(columns.name.getSQLType()).toBe("text")
		expect(columns.platform.notNull).toBe(true)
		expect(columns.platform.getSQLType()).toBe("host_platform")
		expect(hostPlatformEnum.schema).toBe("sando")
		expect(hostPlatformEnum.enumValues).toEqual(["linux-wsl"])
		expect(columns.runtime.notNull).toBe(true)
		expect(columns.runtime.getSQLType()).toBe("sandbox_runtime")
		expect(sandboxRuntimeEnum.schema).toBe("sando")
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

	it("defines the Agent metadata table", () => {
		const columns = getTableColumns(agent)
		const config = getTableConfig(agent)

		expect(config.name).toBe("agent")
		expect(config.schema).toBe("sando")
		expect(columns.id.primary).toBe(true)
		expect(columns.userId.notNull).toBe(true)
		expect(columns.userId.getSQLType()).toBe(`varchar(${idColumnLength})`)
		expect(columns.hostId.notNull).toBe(true)
		expect(columns.hostId.getSQLType()).toBe(`varchar(${idColumnLength})`)
		expect(columns.kind.notNull).toBe(true)
		expect(columns.kind.getSQLType()).toBe("agent_kind")
		expect(agentKindEnum.schema).toBe("sando")
		expect(agentKindEnum.enumValues).toEqual(["codex"])
		expect(columns.displayName.notNull).toBe(true)
		expect(columns.displayName.getSQLType()).toBe("text")
		expect(columns.createdAt.notNull).toBe(true)
		expect(columns.createdAt.hasDefault).toBe(true)
		expect(columns.lastSeenAt.notNull).toBe(true)
		expect(columns.lastSeenAt.hasDefault).toBe(true)
		expect(columns.lastSeenAt.getSQLType()).toBe("timestamp with time zone")
	})

	it("keeps agent registration unique per host, kind, and display name", () => {
		const config = getTableConfig(agent)
		const uniqueIndex = config.indexes.find(
			(index) => index.config.name === "agent_host_kind_display_name_unique",
		)

		expect(uniqueIndex?.config.unique).toBe(true)
		expect(
			uniqueIndex?.config.columns.map((column) => ("name" in column ? column.name : undefined)),
		).toEqual(["host_id", "kind", "display_name"])
	})

	it("defines the Grant metadata table", () => {
		const columns = getTableColumns(grant)
		const config = getTableConfig(grant)

		expect(config.name).toBe("grant")
		expect(config.schema).toBe("sando")
		expect(columns.id.primary).toBe(true)
		expect(columns.userId.notNull).toBe(true)
		expect(columns.projectId.notNull).toBe(true)
		expect(columns.hostId.notNull).toBe(true)
		expect(columns.agentId.notNull).toBe(true)
		expect(columns.capabilities.notNull).toBe(true)
		expect(columns.capabilities.hasDefault).toBe(true)
		expect(columns.capabilities.getSQLType()).toBe("jsonb")
		expect(columns.constraints.notNull).toBe(true)
		expect(columns.constraints.hasDefault).toBe(true)
		expect(columns.constraints.getSQLType()).toBe("jsonb")
		expect(columns.scope.notNull).toBe(true)
		expect(columns.scope.getSQLType()).toBe("grant_scope")
		expect(grantScopeEnum.schema).toBe("sando")
		expect(grantScopeEnum.enumValues).toEqual(["one_shot", "project_window"])
		expect(columns.status.notNull).toBe(true)
		expect(columns.status.getSQLType()).toBe("grant_status")
		expect(grantStatusEnum.schema).toBe("sando")
		expect(grantStatusEnum.enumValues).toEqual([
			"pending",
			"approved",
			"denied",
			"expired",
			"revoked",
		])
		expect(columns.expiresAt.notNull).toBe(false)
		expect(columns.createdAt.notNull).toBe(true)
		expect(columns.createdAt.hasDefault).toBe(true)
		expect(columns.approvedAt.notNull).toBe(false)
	})

	it("indexes grants by authorization lookup fields", () => {
		const config = getTableConfig(grant)
		const lookupIndex = config.indexes.find(
			(index) => index.config.name === "grant_authorization_lookup_idx",
		)

		expect(lookupIndex?.config.unique).toBe(false)
		expect(
			lookupIndex?.config.columns.map((column) => ("name" in column ? column.name : undefined)),
		).toEqual(["project_id", "host_id", "agent_id", "status"])
	})

	it("defines the Run metadata table", () => {
		const columns = getTableColumns(run)
		const config = getTableConfig(run)

		expect(config.name).toBe("run")
		expect(config.schema).toBe("sando")
		expect(columns.id.primary).toBe(true)
		expect(columns.userId.notNull).toBe(true)
		expect(columns.projectId.notNull).toBe(true)
		expect(columns.hostId.notNull).toBe(true)
		expect(columns.agentId.notNull).toBe(true)
		expect(columns.grantId.notNull).toBe(true)
		expect(columns.command.notNull).toBe(true)
		expect(columns.command.getSQLType()).toBe("text")
		expect(columns.template.notNull).toBe(true)
		expect(columns.template.getSQLType()).toBe("text")
		expect(columns.runtime.notNull).toBe(true)
		expect(columns.runtime.getSQLType()).toBe("sandbox_runtime")
		expect(sandboxRuntimeEnum.schema).toBe("sando")
		expect(columns.network.notNull).toBe(true)
		expect(columns.network.getSQLType()).toBe("network_mode")
		expect(networkModeEnum.schema).toBe("sando")
		expect(networkModeEnum.enumValues).toEqual(["none", "default"])
		expect(columns.status.notNull).toBe(true)
		expect(columns.status.getSQLType()).toBe("run_status")
		expect(runStatusEnum.schema).toBe("sando")
		expect(runStatusEnum.enumValues).toEqual([
			"queued",
			"running",
			"succeeded",
			"failed",
			"cancelled",
			"timed_out",
		])
		expect(columns.exitCode.notNull).toBe(false)
		expect(columns.exitCode.getSQLType()).toBe("integer")
		expect(columns.startedAt.notNull).toBe(false)
		expect(columns.finishedAt.notNull).toBe(false)
		expect(columns.durationMs.notNull).toBe(false)
		expect(columns.durationMs.getSQLType()).toBe("integer")
	})

	it("indexes runs by project status and grant", () => {
		const config = getTableConfig(run)
		const projectStatusIndex = config.indexes.find(
			(index) => index.config.name === "run_project_status_idx",
		)
		const grantIndex = config.indexes.find((index) => index.config.name === "run_grant_idx")

		expect(projectStatusIndex?.config.unique).toBe(false)
		expect(
			projectStatusIndex?.config.columns.map((column) =>
				"name" in column ? column.name : undefined,
			),
		).toEqual(["project_id", "status"])
		expect(grantIndex?.config.unique).toBe(false)
		expect(
			grantIndex?.config.columns.map((column) => ("name" in column ? column.name : undefined)),
		).toEqual(["grant_id"])
	})

	it("defines the Artifact metadata table", () => {
		const columns = getTableColumns(artifact)
		const config = getTableConfig(artifact)

		expect(config.name).toBe("artifact")
		expect(config.schema).toBe("sando")
		expect(columns.id.primary).toBe(true)
		expect(columns.runId.notNull).toBe(true)
		expect(columns.runId.getSQLType()).toBe(`varchar(${idColumnLength})`)
		expect(columns.projectId.notNull).toBe(true)
		expect(columns.projectId.getSQLType()).toBe(`varchar(${idColumnLength})`)
		expect(columns.name.notNull).toBe(true)
		expect(columns.name.getSQLType()).toBe("text")
		expect(columns.path.notNull).toBe(true)
		expect(columns.path.getSQLType()).toBe("text")
		expect(columns.contentType.notNull).toBe(false)
		expect(columns.contentType.getSQLType()).toBe("text")
		expect(columns.sizeBytes.notNull).toBe(false)
		expect(columns.sizeBytes.getSQLType()).toBe("integer")
		expect(columns.storageKey.notNull).toBe(true)
		expect(columns.storageKey.getSQLType()).toBe("text")
		expect(columns.private.notNull).toBe(true)
		expect(columns.private.hasDefault).toBe(true)
		expect(columns.private.getSQLType()).toBe("boolean")
		expect(columns.createdAt.notNull).toBe(true)
		expect(columns.createdAt.hasDefault).toBe(true)
		expect(columns.retentionExpiresAt.notNull).toBe(false)
		expect(columns.retentionExpiresAt.getSQLType()).toBe("timestamp with time zone")
	})

	it("indexes artifacts by run and storage identity", () => {
		const config = getTableConfig(artifact)
		const runIndex = config.indexes.find((index) => index.config.name === "artifact_run_idx")
		const storageKeyIndex = config.indexes.find(
			(index) => index.config.name === "artifact_storage_key_unique",
		)
		const runPathIndex = config.indexes.find(
			(index) => index.config.name === "artifact_run_path_unique",
		)

		expect(runIndex?.config.unique).toBe(false)
		expect(
			runIndex?.config.columns.map((column) => ("name" in column ? column.name : undefined)),
		).toEqual(["run_id"])
		expect(storageKeyIndex?.config.unique).toBe(true)
		expect(
			storageKeyIndex?.config.columns.map((column) => ("name" in column ? column.name : undefined)),
		).toEqual(["storage_key"])
		expect(runPathIndex?.config.unique).toBe(true)
		expect(
			runPathIndex?.config.columns.map((column) => ("name" in column ? column.name : undefined)),
		).toEqual(["run_id", "path"])
	})

	it("defines the AuditEvent metadata table", () => {
		const columns = getTableColumns(auditEvent)
		const config = getTableConfig(auditEvent)

		expect(config.name).toBe("audit_event")
		expect(config.schema).toBe("sando")
		expect(columns.id.primary).toBe(true)
		expect(columns.type.notNull).toBe(true)
		expect(columns.type.getSQLType()).toBe("audit_event_type")
		expect(auditEventTypeEnum.schema).toBe("sando")
		expect(auditEventTypeEnum.enumValues).toEqual([
			"agent.registered",
			"host.registered",
			"project.initialized",
			"grant.requested",
			"grant.approved",
			"grant.denied",
			"capability.executed",
			"run.created",
			"workspace.archived",
			"sandbox.created",
			"command.started",
			"command.finished",
			"artifact.uploaded",
			"diff.created",
			"sandbox.destroyed",
			"grant.expired",
		])
		expect(columns.userId.notNull).toBe(true)
		expect(columns.projectId.notNull).toBe(false)
		expect(columns.hostId.notNull).toBe(false)
		expect(columns.agentId.notNull).toBe(false)
		expect(columns.grantId.notNull).toBe(false)
		expect(columns.runId.notNull).toBe(false)
		expect(columns.timestamp.notNull).toBe(true)
		expect(columns.timestamp.hasDefault).toBe(true)
		expect(columns.timestamp.getSQLType()).toBe("timestamp with time zone")
		expect(columns.metadata.notNull).toBe(true)
		expect(columns.metadata.hasDefault).toBe(true)
		expect(columns.metadata.getSQLType()).toBe("jsonb")
	})

	it("indexes audit events by user and run timelines", () => {
		const config = getTableConfig(auditEvent)
		const userTimelineIndex = config.indexes.find(
			(index) => index.config.name === "audit_event_user_timestamp_idx",
		)
		const runTimelineIndex = config.indexes.find(
			(index) => index.config.name === "audit_event_run_timestamp_idx",
		)

		expect(userTimelineIndex?.config.unique).toBe(false)
		expect(
			userTimelineIndex?.config.columns.map((column) =>
				"name" in column ? column.name : undefined,
			),
		).toEqual(["user_id", "timestamp"])
		expect(runTimelineIndex?.config.unique).toBe(false)
		expect(
			runTimelineIndex?.config.columns.map((column) =>
				"name" in column ? column.name : undefined,
			),
		).toEqual(["run_id", "timestamp"])
	})
})
