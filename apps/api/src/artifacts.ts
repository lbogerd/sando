import { Hono } from "hono"

import { isIdOfKind, sandoError, type ArtifactRecord, type RunId, type UserId } from "@sando/shared"

import type { CurrentUserResolver } from "./current-user.js"
import { unauthorizedError } from "./http.js"

export type ListRunArtifactsCommand = {
	readonly runId: RunId
	readonly userId: UserId
}

export type ListRunArtifactsResult = {
	readonly artifacts: readonly ArtifactRecord[]
}

export type ArtifactRepository = {
	readonly listRunArtifacts: (
		input: ListRunArtifactsCommand,
	) => ListRunArtifactsResult | Promise<ListRunArtifactsResult>
}

export type MemoryArtifactRecord = {
	readonly artifact: ArtifactRecord
	readonly userId: UserId
}

export type MemoryArtifactRepositoryOptions = {
	readonly artifacts?: readonly MemoryArtifactRecord[]
}

export type ArtifactRoutesOptions = {
	readonly artifactRepository: ArtifactRepository
	readonly currentUser: CurrentUserResolver
}

export function createMemoryArtifactRepository(
	options: MemoryArtifactRepositoryOptions = {},
): ArtifactRepository {
	const artifacts = [...(options.artifacts ?? [])]

	return {
		listRunArtifacts(input) {
			return {
				artifacts: artifacts
					.filter(
						(record) => record.userId === input.userId && record.artifact.runId === input.runId,
					)
					.map((record) => record.artifact),
			}
		},
	}
}

export function createArtifactRoutes(options: ArtifactRoutesOptions): Hono {
	const routes = new Hono()

	routes.get("/runs/:runId/artifacts", async (context) => {
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

		const result = await options.artifactRepository.listRunArtifacts({
			runId: rawRunId,
			userId: currentUser.userId,
		})

		return context.json(result)
	})

	return routes
}
