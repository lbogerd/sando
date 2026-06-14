import { Hono } from "hono"

import {
	asId,
	parseRegisterHostInput,
	type HostId,
	type HostRecord,
	type HostRegistrationResult,
	type RegisterHostInput,
	type UserId,
} from "@sando/shared"

import type { CurrentUserResolver } from "./current-user.js"
import { readJsonBody, unauthorizedError } from "./http.js"

export type RegisterHostCommand = RegisterHostInput & {
	readonly userId: UserId
	readonly now: Date
}

export type HostRepository = {
	readonly registerHost: (
		input: RegisterHostCommand,
	) => HostRegistrationResult | Promise<HostRegistrationResult>
}

export type MemoryHostRepositoryOptions = {
	readonly generateId?: () => string
}

export type HostRoutesOptions = {
	readonly currentUser: CurrentUserResolver
	readonly hostRepository: HostRepository
	readonly now: () => Date
}

export function createMemoryHostRepository(
	options: MemoryHostRepositoryOptions = {},
): HostRepository {
	const generateId = options.generateId ?? (() => crypto.randomUUID())
	const byId = new Map<HostId, HostRecord>()
	const byUserFingerprint = new Map<string, HostId>()

	return {
		registerHost(input) {
			const now = input.now.toISOString()
			const fingerprintKey = hostFingerprintKey(input.userId, input.fingerprint)
			const existingId = byUserFingerprint.get(fingerprintKey)

			if (existingId !== undefined) {
				const existing = byId.get(existingId)

				if (existing !== undefined) {
					const refreshed: HostRecord = {
						...existing,
						name: input.name,
						platform: input.platform,
						runtime: input.runtime,
						lastSeenAt: now,
					}

					byId.set(refreshed.id, refreshed)

					return {
						host: refreshed,
						created: false,
					}
				}
			}

			const host: HostRecord = {
				id: asId("host", `host_${generateId()}`),
				userId: input.userId,
				name: input.name,
				platform: input.platform,
				runtime: input.runtime,
				fingerprint: input.fingerprint,
				createdAt: now,
				lastSeenAt: now,
			}

			byId.set(host.id, host)
			byUserFingerprint.set(fingerprintKey, host.id)

			return {
				host,
				created: true,
			}
		},
	}
}

export function createHostRoutes(options: HostRoutesOptions): Hono {
	const routes = new Hono()

	routes.post("/hosts/register", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.json({ error: unauthorizedError() }, 401)
		}

		const rawBody = await readJsonBody(context.req.raw)

		if (!rawBody.ok) {
			return context.json({ error: rawBody.error }, 400)
		}

		const input = parseRegisterHostInput(rawBody.value)

		if (!input.ok) {
			return context.json({ error: input.error }, 400)
		}

		const result = await options.hostRepository.registerHost({
			...input.value,
			userId: currentUser.userId,
			now: options.now(),
		})

		return context.json(result, result.created ? 201 : 200)
	})

	return routes
}

function hostFingerprintKey(userId: UserId, fingerprint: string): string {
	return `${userId}\0${fingerprint}`
}
