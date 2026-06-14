import { Hono } from "hono"

import {
	asId,
	parseCreateRunInput,
	type CreateRunInput,
	type CreateRunResult,
	type RunId,
	type RunRecord,
	type UserId,
} from "@sando/shared"

import type { CurrentUserResolver } from "./current-user.js"
import { readJsonBody, unauthorizedError } from "./http.js"

export type CreateRunCommand = CreateRunInput & {
	readonly userId: UserId
}

export type RunRepository = {
	readonly createRun: (input: CreateRunCommand) => CreateRunResult | Promise<CreateRunResult>
}

export type MemoryRunRepositoryOptions = {
	readonly generateId?: () => string
}

export type RunRoutesOptions = {
	readonly currentUser: CurrentUserResolver
	readonly runRepository: RunRepository
}

export function createMemoryRunRepository(options: MemoryRunRepositoryOptions = {}): RunRepository {
	const generateId = options.generateId ?? (() => crypto.randomUUID())
	const byId = new Map<RunId, RunRecord>()

	return {
		createRun(input) {
			const run: RunRecord = {
				id: asId("run", `run_${generateId()}`),
				userId: input.userId,
				projectId: input.projectId,
				hostId: input.hostId,
				agentId: input.agentId,
				grantId: input.grantId,
				command: input.command,
				template: input.template,
				runtime: input.runtime,
				network: input.network,
				status: "queued",
			}

			byId.set(run.id, run)

			return { run }
		},
	}
}

export function createRunRoutes(options: RunRoutesOptions): Hono {
	const routes = new Hono()

	routes.post("/runs", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.json({ error: unauthorizedError() }, 401)
		}

		const rawBody = await readJsonBody(context.req.raw)

		if (!rawBody.ok) {
			return context.json({ error: rawBody.error }, 400)
		}

		const input = parseCreateRunInput(rawBody.value)

		if (!input.ok) {
			return context.json({ error: input.error }, 400)
		}

		const result = await options.runRepository.createRun({
			...input.value,
			userId: currentUser.userId,
		})

		return context.json(result, 201)
	})

	return routes
}
