import { Hono } from "hono"

import {
	asId,
	isIdOfKind,
	parseCreateArtifactMetadataInput,
	sandoError,
	type ArtifactRecord,
	type CreateArtifactMetadataInput,
	type CreateArtifactMetadataResult,
	type RunId,
	type UserId,
} from "@sando/shared"

import type { AuditEventRepository } from "./audit-events.js"
import type { CurrentUserResolver } from "./current-user.js"
import { readJsonBody, unauthorizedError } from "./http.js"

export type CreateArtifactMetadataCommand = CreateArtifactMetadataInput & {
	readonly now: Date
	readonly userId: UserId
}

export type ListRunArtifactsCommand = {
	readonly runId: RunId
	readonly userId: UserId
}

export type ListRunArtifactsResult = {
	readonly artifacts: readonly ArtifactRecord[]
}

export type ArtifactRepository = {
	readonly createArtifactMetadata: (
		input: CreateArtifactMetadataCommand,
	) => CreateArtifactMetadataResult | Promise<CreateArtifactMetadataResult>
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
	readonly auditEventRepository?: AuditEventRepository
	readonly artifactRepository: ArtifactRepository
	readonly currentUser: CurrentUserResolver
	readonly now: () => Date
}

export function createMemoryArtifactRepository(
	options: MemoryArtifactRepositoryOptions = {},
): ArtifactRepository {
	const artifacts = [...(options.artifacts ?? [])]

	return {
		createArtifactMetadata(input) {
			const artifact: ArtifactRecord = {
				id: asId("artifact", `art_${crypto.randomUUID()}`),
				runId: input.runId,
				projectId: input.projectId,
				name: input.name,
				uri: input.uri,
				path: input.path,
				...(input.contentType === undefined ? {} : { contentType: input.contentType }),
				...(input.sizeBytes === undefined ? {} : { sizeBytes: input.sizeBytes }),
				storageKey: input.uri,
				private: input.private,
				createdAt: input.now.toISOString(),
				...(input.retentionExpiresAt === undefined
					? {}
					: { retentionExpiresAt: input.retentionExpiresAt }),
			}

			artifacts.push({
				userId: input.userId,
				artifact,
			})

			return { artifact }
		},

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

	routes.post("/runs/:runId/artifacts", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.json({ error: unauthorizedError() }, 401)
		}

		const runId = parseRunIdParam(context.req.param("runId"))

		if (!runId.ok) {
			return context.json({ error: runId.error }, 400)
		}

		const rawBody = await readJsonBody(context.req.raw)

		if (!rawBody.ok) {
			return context.json({ error: rawBody.error }, 400)
		}

		const input = parseCreateArtifactMetadataInput({
			...(typeof rawBody.value === "object" &&
			rawBody.value !== null &&
			!Array.isArray(rawBody.value)
				? rawBody.value
				: {}),
			runId: runId.value,
		})

		if (!input.ok) {
			return context.json({ error: input.error }, 400)
		}

		const result = await options.artifactRepository.createArtifactMetadata({
			...input.value,
			userId: currentUser.userId,
			now: options.now(),
		})

		await options.auditEventRepository?.appendAuditEvent({
			type: "artifact.uploaded",
			userId: currentUser.userId,
			projectId: result.artifact.projectId,
			runId: result.artifact.runId,
			now: options.now(),
			metadata: {
				artifactId: result.artifact.id,
				name: result.artifact.name,
				uri: result.artifact.uri,
				path: result.artifact.path,
				...(result.artifact.contentType === undefined
					? {}
					: { contentType: result.artifact.contentType }),
				...(result.artifact.sizeBytes === undefined
					? {}
					: { sizeBytes: result.artifact.sizeBytes }),
				private: result.artifact.private,
				...(result.artifact.retentionExpiresAt === undefined
					? {}
					: { retentionExpiresAt: result.artifact.retentionExpiresAt }),
			},
		})

		return context.json(result, 201)
	})

	routes.get("/runs/:runId/artifacts", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.json({ error: unauthorizedError() }, 401)
		}

		const runId = parseRunIdParam(context.req.param("runId"))

		if (!runId.ok) {
			return context.json({ error: runId.error }, 400)
		}

		const result = await options.artifactRepository.listRunArtifacts({
			runId: runId.value,
			userId: currentUser.userId,
		})

		return context.json(result)
	})

	return routes
}

function parseRunIdParam(value: string):
	| { readonly ok: true; readonly value: RunId }
	| {
			readonly ok: false
			readonly error: ReturnType<typeof sandoError>
	  } {
	if (isIdOfKind("run", value)) {
		return { ok: true, value }
	}

	return {
		ok: false,
		error: sandoError({
			code: "VALIDATION_FAILED",
			message: "Invalid run ID.",
			details: {
				issues: [{ path: "$.runId", message: "Expected a run ID." }],
			},
		}),
	}
}
