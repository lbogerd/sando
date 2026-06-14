import { jsonb, pgSchema, timestamp, varchar } from "drizzle-orm/pg-core"

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
