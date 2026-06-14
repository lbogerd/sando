import { Hono } from "hono"

import {
	asId,
	isIdOfKind,
	parseRegisterProjectInput,
	sandoError,
	type ProjectId,
	type ProjectRecord,
	type ProjectRegistrationResult,
	type RegisterProjectInput,
	type UserId,
} from "@sando/shared"

import type { CurrentUserResolver } from "./current-user.js"
import { readJsonBody, unauthorizedError } from "./http.js"

export type RegisterProjectCommand = RegisterProjectInput & {
	readonly userId: UserId
	readonly now: Date
}

export type GetProjectCommand = {
	readonly userId: UserId
	readonly projectId: ProjectId
}

export type ProjectRepository = {
	readonly registerProject: (
		input: RegisterProjectCommand,
	) => ProjectRegistrationResult | Promise<ProjectRegistrationResult>
	readonly getProject: (
		input: GetProjectCommand,
	) => ProjectRecord | null | Promise<ProjectRecord | null>
}

export type MemoryProjectRepositoryOptions = {
	readonly generateId?: () => string
}

export type ProjectRoutesOptions = {
	readonly currentUser: CurrentUserResolver
	readonly now: () => Date
	readonly projectRepository: ProjectRepository
}

export function createMemoryProjectRepository(
	options: MemoryProjectRepositoryOptions = {},
): ProjectRepository {
	const generateId = options.generateId ?? (() => crypto.randomUUID())
	const byId = new Map<ProjectId, ProjectRecord>()
	const byUserFingerprint = new Map<string, ProjectId>()

	return {
		registerProject(input) {
			const fingerprintKey = projectFingerprintKey(input.userId, input.localFingerprint)
			const existingId = byUserFingerprint.get(fingerprintKey)

			if (existingId !== undefined) {
				const existing = byId.get(existingId)

				if (existing !== undefined) {
					return {
						project: existing,
						created: false,
					}
				}
			}

			const project: ProjectRecord = {
				id: asId("project", `proj_${generateId()}`),
				userId: input.userId,
				name: input.name,
				localFingerprint: input.localFingerprint,
				policyId: input.policyId,
				createdAt: input.now.toISOString(),
			}

			byId.set(project.id, project)
			byUserFingerprint.set(fingerprintKey, project.id)

			return {
				project,
				created: true,
			}
		},

		getProject(input) {
			const project = byId.get(input.projectId)

			if (project === undefined || project.userId !== input.userId) {
				return null
			}

			return project
		},
	}
}

export function createProjectRoutes(options: ProjectRoutesOptions): Hono {
	const routes = new Hono()

	routes.post("/projects/register", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.json({ error: unauthorizedError() }, 401)
		}

		const rawBody = await readJsonBody(context.req.raw)

		if (!rawBody.ok) {
			return context.json({ error: rawBody.error }, 400)
		}

		const input = parseRegisterProjectInput(rawBody.value)

		if (!input.ok) {
			return context.json({ error: input.error }, 400)
		}

		const result = await options.projectRepository.registerProject({
			...input.value,
			userId: currentUser.userId,
			now: options.now(),
		})

		return context.json(result, result.created ? 201 : 200)
	})

	routes.get("/projects/:projectId", async (context) => {
		const currentUser = await options.currentUser(context.req.raw)

		if (currentUser === null) {
			return context.json({ error: unauthorizedError() }, 401)
		}

		const rawProjectId = context.req.param("projectId")

		if (!isIdOfKind("project", rawProjectId)) {
			return context.json(
				{
					error: sandoError({
						code: "VALIDATION_FAILED",
						message: "Invalid project ID.",
						details: {
							issues: [{ path: "$.projectId", message: "Expected a project ID." }],
						},
					}),
				},
				400,
			)
		}

		const project = await options.projectRepository.getProject({
			userId: currentUser.userId,
			projectId: rawProjectId,
		})

		if (project === null) {
			return context.json(
				{
					error: sandoError({
						code: "NOT_FOUND",
						message: "Project not found.",
					}),
				},
				404,
			)
		}

		return context.json({ project })
	})

	return routes
}

function projectFingerprintKey(userId: UserId, localFingerprint: string): string {
	return `${userId}\0${localFingerprint}`
}
