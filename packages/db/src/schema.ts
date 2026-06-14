import type { InferInsertModel, InferSelectModel } from "drizzle-orm"
import {
	boolean,
	index,
	integer,
	jsonb,
	pgSchema,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core"

import {
	networkModes,
	runProjectCommandStatuses,
	sandboxRuntimeKinds,
	type JsonValue,
} from "@sando/shared"

export const databaseSchemaName = "sandhost"
export const sandhostSchema = pgSchema(databaseSchemaName)

export const idColumnLength = 128

export const hostPlatformValues = ["linux-wsl"] as const
export const agentKindValues = ["codex"] as const
export const grantScopeValues = ["one_shot", "project_window"] as const
export const grantStatusValues = ["pending", "approved", "denied", "expired", "revoked"] as const
export const runStatusValues = ["queued", "running", ...runProjectCommandStatuses] as const
export const auditEventTypeValues = [
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
] as const

export const hostPlatformEnum = sandhostSchema.enum("host_platform", hostPlatformValues)
export const agentKindEnum = sandhostSchema.enum("agent_kind", agentKindValues)
export const grantScopeEnum = sandhostSchema.enum("grant_scope", grantScopeValues)
export const grantStatusEnum = sandhostSchema.enum("grant_status", grantStatusValues)
export const runStatusEnum = sandhostSchema.enum("run_status", runStatusValues)
export const auditEventTypeEnum = sandhostSchema.enum("audit_event_type", auditEventTypeValues)
export const networkModeEnum = sandhostSchema.enum("network_mode", networkModes)
export const sandboxRuntimeEnum = sandhostSchema.enum("sandbox_runtime", sandboxRuntimeKinds)

export type HostPlatform = (typeof hostPlatformValues)[number]
export type AgentKind = (typeof agentKindValues)[number]
export type GrantScope = (typeof grantScopeValues)[number]
export type GrantStatus = (typeof grantStatusValues)[number]
export type RunStatus = (typeof runStatusValues)[number]
export type AuditEventType = (typeof auditEventTypeValues)[number]
export type MetadataJson = Record<string, JsonValue>

export function idColumn(name = "id") {
	return varchar(name, { length: idColumnLength })
}

export function optionalTimestampColumn(name: string) {
	return timestamp(name, { mode: "string", withTimezone: true })
}

export function requiredTimestampColumn(name: string) {
	return optionalTimestampColumn(name).notNull()
}

export function createdAtColumn(name = "created_at") {
	return requiredTimestampColumn(name).defaultNow()
}

export function metadataJsonColumn(name = "metadata") {
	return jsonb(name).$type<MetadataJson>().notNull()
}

function capabilitiesJsonColumn(name = "capabilities") {
	return jsonb(name).$type<string[]>().notNull().default([])
}

function constraintsJsonColumn(name = "constraints") {
	return jsonb(name).$type<MetadataJson>().notNull().default({})
}

function auditMetadataJsonColumn(name = "metadata") {
	return jsonb(name).$type<MetadataJson>().notNull().default({})
}

function authTimestampColumn(name: string) {
	return timestamp(name, { withTimezone: true })
}

function requiredAuthTimestampColumn(name: string) {
	return authTimestampColumn(name).notNull()
}

function authCreatedAtColumn() {
	return requiredAuthTimestampColumn("created_at").defaultNow()
}

function authUpdatedAtColumn() {
	return requiredAuthTimestampColumn("updated_at").defaultNow()
}

export const user = sandhostSchema.table("user", {
	id: idColumn().primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	createdAt: authCreatedAtColumn(),
	updatedAt: authUpdatedAtColumn(),
})

export const session = sandhostSchema.table("session", {
	id: idColumn().primaryKey(),
	expiresAt: requiredAuthTimestampColumn("expires_at"),
	token: text("token").notNull().unique(),
	createdAt: authCreatedAtColumn(),
	updatedAt: authUpdatedAtColumn(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: idColumn("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
})

export const account = sandhostSchema.table("account", {
	id: idColumn().primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: idColumn("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: authTimestampColumn("access_token_expires_at"),
	refreshTokenExpiresAt: authTimestampColumn("refresh_token_expires_at"),
	scope: text("scope"),
	password: text("password"),
	createdAt: authCreatedAtColumn(),
	updatedAt: authUpdatedAtColumn(),
})

export const verification = sandhostSchema.table("verification", {
	id: idColumn().primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: requiredAuthTimestampColumn("expires_at"),
	createdAt: authCreatedAtColumn(),
	updatedAt: authUpdatedAtColumn(),
})

export const betterAuthSchema = {
	user,
	session,
	account,
	verification,
} as const

export const project = sandhostSchema.table(
	"project",
	{
		id: idColumn().primaryKey(),
		userId: idColumn("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		localFingerprint: text("local_fingerprint").notNull(),
		policyId: idColumn("policy_id").notNull(),
		createdAt: createdAtColumn(),
	},
	(table) => [
		uniqueIndex("project_user_local_fingerprint_unique").on(table.userId, table.localFingerprint),
	],
)

export type Project = InferSelectModel<typeof project>
export type NewProject = InferInsertModel<typeof project>

export const host = sandhostSchema.table(
	"host",
	{
		id: idColumn().primaryKey(),
		userId: idColumn("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		platform: hostPlatformEnum("platform").notNull(),
		runtime: sandboxRuntimeEnum("runtime").notNull(),
		fingerprint: text("fingerprint").notNull(),
		createdAt: createdAtColumn(),
		lastSeenAt: createdAtColumn("last_seen_at"),
	},
	(table) => [uniqueIndex("host_user_fingerprint_unique").on(table.userId, table.fingerprint)],
)

export type Host = InferSelectModel<typeof host>
export type NewHost = InferInsertModel<typeof host>

export const agent = sandhostSchema.table(
	"agent",
	{
		id: idColumn().primaryKey(),
		userId: idColumn("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		hostId: idColumn("host_id")
			.notNull()
			.references(() => host.id, { onDelete: "cascade" }),
		kind: agentKindEnum("kind").notNull(),
		displayName: text("display_name").notNull(),
		createdAt: createdAtColumn(),
		lastSeenAt: createdAtColumn("last_seen_at"),
	},
	(table) => [
		uniqueIndex("agent_host_kind_display_name_unique").on(
			table.hostId,
			table.kind,
			table.displayName,
		),
	],
)

export type Agent = InferSelectModel<typeof agent>
export type NewAgent = InferInsertModel<typeof agent>

export const grant = sandhostSchema.table(
	"grant",
	{
		id: idColumn().primaryKey(),
		userId: idColumn("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		projectId: idColumn("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		hostId: idColumn("host_id")
			.notNull()
			.references(() => host.id, { onDelete: "cascade" }),
		agentId: idColumn("agent_id")
			.notNull()
			.references(() => agent.id, { onDelete: "cascade" }),
		capabilities: capabilitiesJsonColumn(),
		constraints: constraintsJsonColumn(),
		scope: grantScopeEnum("scope").notNull(),
		status: grantStatusEnum("status").notNull(),
		expiresAt: optionalTimestampColumn("expires_at"),
		createdAt: createdAtColumn(),
		approvedAt: optionalTimestampColumn("approved_at"),
	},
	(table) => [
		index("grant_authorization_lookup_idx").on(
			table.projectId,
			table.hostId,
			table.agentId,
			table.status,
		),
	],
)

export type Grant = InferSelectModel<typeof grant>
export type NewGrant = InferInsertModel<typeof grant>

export const run = sandhostSchema.table(
	"run",
	{
		id: idColumn().primaryKey(),
		userId: idColumn("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		projectId: idColumn("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		hostId: idColumn("host_id")
			.notNull()
			.references(() => host.id, { onDelete: "cascade" }),
		agentId: idColumn("agent_id")
			.notNull()
			.references(() => agent.id, { onDelete: "cascade" }),
		grantId: idColumn("grant_id")
			.notNull()
			.references(() => grant.id, { onDelete: "cascade" }),
		command: text("command").notNull(),
		template: text("template").notNull(),
		runtime: sandboxRuntimeEnum("runtime").notNull(),
		network: networkModeEnum("network").notNull(),
		status: runStatusEnum("status").notNull(),
		exitCode: integer("exit_code"),
		startedAt: optionalTimestampColumn("started_at"),
		finishedAt: optionalTimestampColumn("finished_at"),
		durationMs: integer("duration_ms"),
	},
	(table) => [
		index("run_project_status_idx").on(table.projectId, table.status),
		index("run_grant_idx").on(table.grantId),
	],
)

export type Run = InferSelectModel<typeof run>
export type NewRun = InferInsertModel<typeof run>

export const artifact = sandhostSchema.table(
	"artifact",
	{
		id: idColumn().primaryKey(),
		runId: idColumn("run_id")
			.notNull()
			.references(() => run.id, { onDelete: "cascade" }),
		projectId: idColumn("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		path: text("path").notNull(),
		contentType: text("content_type"),
		sizeBytes: integer("size_bytes"),
		uploadThingKey: text("upload_thing_key").notNull(),
		private: boolean("private").notNull().default(true),
		createdAt: createdAtColumn(),
		retentionExpiresAt: optionalTimestampColumn("retention_expires_at"),
	},
	(table) => [
		index("artifact_run_idx").on(table.runId),
		uniqueIndex("artifact_upload_thing_key_unique").on(table.uploadThingKey),
		uniqueIndex("artifact_run_path_unique").on(table.runId, table.path),
	],
)

export type Artifact = InferSelectModel<typeof artifact>
export type NewArtifact = InferInsertModel<typeof artifact>

export const auditEvent = sandhostSchema.table(
	"audit_event",
	{
		id: idColumn().primaryKey(),
		type: auditEventTypeEnum("type").notNull(),
		userId: idColumn("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		projectId: idColumn("project_id").references(() => project.id, { onDelete: "set null" }),
		hostId: idColumn("host_id").references(() => host.id, { onDelete: "set null" }),
		agentId: idColumn("agent_id").references(() => agent.id, { onDelete: "set null" }),
		grantId: idColumn("grant_id").references(() => grant.id, { onDelete: "set null" }),
		runId: idColumn("run_id").references(() => run.id, { onDelete: "set null" }),
		timestamp: requiredTimestampColumn("timestamp").defaultNow(),
		metadata: auditMetadataJsonColumn(),
	},
	(table) => [
		index("audit_event_user_timestamp_idx").on(table.userId, table.timestamp),
		index("audit_event_run_timestamp_idx").on(table.runId, table.timestamp),
	],
)

export type AuditEvent = InferSelectModel<typeof auditEvent>
export type NewAuditEvent = InferInsertModel<typeof auditEvent>
