import type { InferInsertModel, InferSelectModel } from "drizzle-orm"
import {
	boolean,
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
