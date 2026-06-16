import { Hono } from "hono"

import {
	asId,
	parseRegisterAgentInput,
	type AgentId,
	type AgentRecord,
	type AgentRegistrationResult,
	type RegisterAgentInput,
	type UserId,
} from "@sando/shared"

import type { AuditEventRepository } from "./audit-events.js"
import type { CurrentUserResolver } from "./current-user.js"
import { readJsonBody, unauthorizedError } from "./http.js"

export type RegisterAgentCommand = RegisterAgentInput & {
	readonly userId: UserId
	readonly now: Date
}

export type AgentRepository = {
	readonly registerAgent: (
		input: RegisterAgentCommand,
	) => AgentRegistrationResult | Promise<AgentRegistrationResult>
}

export type MemoryAgentRepositoryOptions = {
	readonly generateId?: () => string
}

export type AgentRoutesOptions = {
	readonly agentRepository: AgentRepository
	readonly auditEventRepository?: AuditEventRepository
	readonly currentUser: CurrentUserResolver
	readonly now: () => Date
}

export function createMemoryAgentRepository(
	options: MemoryAgentRepositoryOptions = {},
): AgentRepository {
	const generateId = options.generateId ?? (() => crypto.randomUUID())
	const byId = new Map<AgentId, AgentRecord>()
	const byHostKindName = new Map<string, AgentId>()

	return {
		registerAgent(input) {
			const now = input.now.toISOString()
			const key = agentKey(input.userId, input.hostId, input.kind, input.displayName)
			const existingId = byHostKindName.get(key)

			if (existingId !== undefined) {
				const existing = byId.get(existingId)

				if (existing !== undefined) {
					const refreshed: AgentRecord = {
						...existing,
						lastSeenAt: now,
					}

					byId.set(refreshed.id, refreshed)

					return {
						agent: refreshed,
						created: false,
					}
				}
			}

			const agent: AgentRecord = {
				id: asId("agent", `agent_${generateId()}`),
				userId: input.userId,
				hostId: input.hostId,
				kind: input.kind,
				displayName: input.displayName,
				createdAt: now,
				lastSeenAt: now,
			}

			byId.set(agent.id, agent)
			byHostKindName.set(key, agent.id)

			return {
				agent,
				created: true,
			}
		},
	}
}

export function createAgentRoutes(options: AgentRoutesOptions): Hono {
	const routes = new Hono()

	routes.post("/agents/register", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.json({ error: unauthorizedError() }, 401)
		}

		const rawBody = await readJsonBody(context.req.raw)

		if (!rawBody.ok) {
			return context.json({ error: rawBody.error }, 400)
		}

		const input = parseRegisterAgentInput(rawBody.value)

		if (!input.ok) {
			return context.json({ error: input.error }, 400)
		}

		const result = await options.agentRepository.registerAgent({
			...input.value,
			userId: currentUser.userId,
			now: options.now(),
		})

		if (result.created) {
			await options.auditEventRepository?.appendAuditEvent({
				type: "agent.registered",
				userId: currentUser.userId,
				hostId: result.agent.hostId,
				agentId: result.agent.id,
				now: options.now(),
				metadata: {
					kind: result.agent.kind,
					displayName: result.agent.displayName,
				},
			})
		}

		return context.json(result, result.created ? 201 : 200)
	})

	return routes
}

function agentKey(userId: UserId, hostId: string, kind: string, displayName: string): string {
	return `${userId}\0${hostId}\0${kind}\0${displayName}`
}
