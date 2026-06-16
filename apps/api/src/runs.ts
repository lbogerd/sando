import { Hono } from "hono"

import {
	asId,
	isIdOfKind,
	parseCreateRunInput,
	parseFinishRunInput,
	sandoError,
	type CreateRunInput,
	type CreateRunResult,
	type FinishRunInput,
	type FinishRunResult,
	type RunId,
	type RunRecord,
	type UserId,
} from "@sando/shared"

import type { AuditEventRepository } from "./audit-events.js"
import type { CurrentUserResolver } from "./current-user.js"
import { readJsonBody, unauthorizedError } from "./http.js"

export type CreateRunCommand = CreateRunInput & {
	readonly userId: UserId
}

export type FinishRunCommand = FinishRunInput & {
	readonly runId: RunId
	readonly userId: UserId
	readonly now: Date
}

export type RunRepository = {
	readonly createRun: (input: CreateRunCommand) => CreateRunResult | Promise<CreateRunResult>
	readonly finishRun: (
		input: FinishRunCommand,
	) => FinishRunResult | null | Promise<FinishRunResult | null>
}

export type MemoryRunRepositoryOptions = {
	readonly generateId?: () => string
}

export type RunRoutesOptions = {
	readonly auditEventRepository?: AuditEventRepository
	readonly currentUser: CurrentUserResolver
	readonly now: () => Date
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

		finishRun(input) {
			const run = byId.get(input.runId)

			if (run === undefined || run.userId !== input.userId) {
				return null
			}

			const finished: RunRecord = {
				...run,
				status: input.status,
				exitCode: input.exitCode,
				durationMs: input.durationMs,
				finishedAt: input.now.toISOString(),
			}

			byId.set(finished.id, finished)

			return { run: finished }
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

		await options.auditEventRepository?.appendAuditEvent({
			type: "run.created",
			userId: currentUser.userId,
			projectId: result.run.projectId,
			hostId: result.run.hostId,
			agentId: result.run.agentId,
			grantId: result.run.grantId,
			runId: result.run.id,
			now: options.now(),
			metadata: {
				command: result.run.command,
				template: result.run.template,
				runtime: result.run.runtime,
				network: result.run.network,
			},
		})

		return context.json(result, 201)
	})

	routes.post("/runs/:runId/finish", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.json({ error: unauthorizedError() }, 401)
		}

		const rawRunId = context.req.param("runId")

		if (!isIdOfKind("run", rawRunId)) {
			return context.json(
				{
					error: sandoError({
						code: "VALIDATION_FAILED",
						message: "Invalid run ID.",
						details: {
							issues: [{ path: "$.runId", message: "Expected a run ID." }],
						},
					}),
				},
				400,
			)
		}

		const rawBody = await readJsonBody(context.req.raw)

		if (!rawBody.ok) {
			return context.json({ error: rawBody.error }, 400)
		}

		const input = parseFinishRunInput(rawBody.value)

		if (!input.ok) {
			return context.json({ error: input.error }, 400)
		}

		const result = await options.runRepository.finishRun({
			...input.value,
			runId: rawRunId,
			userId: currentUser.userId,
			now: options.now(),
		})

		if (result === null) {
			return context.json(
				{
					error: sandoError({
						code: "NOT_FOUND",
						message: "Run not found.",
					}),
				},
				404,
			)
		}

		await options.auditEventRepository?.appendAuditEvent({
			type: "command.finished",
			userId: currentUser.userId,
			projectId: result.run.projectId,
			hostId: result.run.hostId,
			agentId: result.run.agentId,
			grantId: result.run.grantId,
			runId: result.run.id,
			now: options.now(),
			metadata: {
				command: result.run.command,
				status: result.run.status,
				exitCode: result.run.exitCode ?? null,
				durationMs: result.run.durationMs ?? 0,
			},
		})

		return context.json(result)
	})

	return routes
}
