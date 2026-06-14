import { Hono } from "hono"

import {
	asId,
	parseAppendAuditEventInput,
	type AppendAuditEventInput,
	type AppendAuditEventResult,
	type AuditEventId,
	type AuditEventRecord,
	type UserId,
} from "@sando/shared"

import type { CurrentUserResolver } from "./current-user.js"
import { readJsonBody, unauthorizedError } from "./http.js"

export type AppendAuditEventCommand = AppendAuditEventInput & {
	readonly userId: UserId
	readonly now: Date
}

export type AuditEventRepository = {
	readonly appendAuditEvent: (
		input: AppendAuditEventCommand,
	) => AppendAuditEventResult | Promise<AppendAuditEventResult>
}

export type MemoryAuditEventRepositoryOptions = {
	readonly generateId?: () => string
}

export type AuditEventRoutesOptions = {
	readonly auditEventRepository: AuditEventRepository
	readonly currentUser: CurrentUserResolver
	readonly now: () => Date
}

export function createMemoryAuditEventRepository(
	options: MemoryAuditEventRepositoryOptions = {},
): AuditEventRepository {
	const generateId = options.generateId ?? (() => crypto.randomUUID())
	const byId = new Map<AuditEventId, AuditEventRecord>()

	return {
		appendAuditEvent(input) {
			const auditEvent: AuditEventRecord = {
				id: asId("auditEvent", `audit_${generateId()}`),
				type: input.type,
				userId: input.userId,
				...(input.projectId === undefined ? {} : { projectId: input.projectId }),
				...(input.hostId === undefined ? {} : { hostId: input.hostId }),
				...(input.agentId === undefined ? {} : { agentId: input.agentId }),
				...(input.grantId === undefined ? {} : { grantId: input.grantId }),
				...(input.runId === undefined ? {} : { runId: input.runId }),
				timestamp: input.now.toISOString(),
				metadata: input.metadata,
			}

			byId.set(auditEvent.id, auditEvent)

			return { auditEvent }
		},
	}
}

export function createAuditEventRoutes(options: AuditEventRoutesOptions): Hono {
	const routes = new Hono()

	routes.post("/audit-events", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.json({ error: unauthorizedError() }, 401)
		}

		const rawBody = await readJsonBody(context.req.raw)

		if (!rawBody.ok) {
			return context.json({ error: rawBody.error }, 400)
		}

		const input = parseAppendAuditEventInput(rawBody.value)

		if (!input.ok) {
			return context.json({ error: input.error }, 400)
		}

		const result = await options.auditEventRepository.appendAuditEvent({
			...input.value,
			userId: currentUser.userId,
			now: options.now(),
		})

		return context.json(result, 201)
	})

	return routes
}
