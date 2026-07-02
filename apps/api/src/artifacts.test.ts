import { describe, expect, it } from "vitest"

import { asId, type AuditEventRecord } from "@sando/shared"

import { type AppendAuditEventCommand, type AuditEventRepository } from "./audit-events.js"
import { createMemoryArtifactRepository } from "./artifacts.js"
import { createHostedApp } from "./index.js"

const userId = asId("user", "user_123")
const otherUserId = asId("user", "user_456")
const fixedNow = new Date("2026-06-14T18:00:00.000Z")
const artifact = {
	id: asId("artifact", "art_123"),
	runId: asId("run", "run_123"),
	projectId: asId("project", "proj_123"),
	name: "changed-files.txt",
	uri: "sando://artifacts/art_123" as const,
	path: "/artifacts/changed-files.txt",
	contentType: "text/plain",
	sizeBytes: 128,
	storageKey: "store_123",
	private: true as const,
	createdAt: "2026-06-14T18:00:00.000Z",
}

describe("artifact API routes", () => {
	it("requires authentication to create artifact metadata", async () => {
		const app = createHostedApp()

		const response = await app.request(
			"/v1/runs/run_123/artifacts",
			jsonRequest(createArtifactBody()),
		)

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({
			error: {
				code: "UNAUTHORIZED",
				message: "Authentication required.",
			},
		})
	})

	it("creates artifact metadata for the current user and records audit", async () => {
		const audit = recordingAuditRepository()
		const artifactRepository = createMemoryArtifactRepository()
		const app = createHostedApp({
			artifactRepository,
			auditEventRepository: audit.repository,
			currentUser: () => ({ userId }),
			now: () => fixedNow,
		})

		const create = await app.request(
			"/v1/runs/run_123/artifacts",
			jsonRequest(createArtifactBody()),
		)
		const list = await app.request("/v1/runs/run_123/artifacts")

		expect(create.status).toBe(201)
		expect(await create.json()).toMatchObject({
			artifact: {
				id: expect.stringMatching(/^art_/u),
				runId: "run_123",
				projectId: "proj_123",
				name: "logs.txt",
				uri: "sando://artifacts/art_logs",
				path: "sando://artifacts/art_logs",
				contentType: "text/plain",
				sizeBytes: 5,
				storageKey: "sando://artifacts/art_logs",
				private: true,
				createdAt: "2026-06-14T18:00:00.000Z",
			},
		})
		expect(await list.json()).toMatchObject({
			artifacts: [
				{
					runId: "run_123",
					name: "logs.txt",
					uri: "sando://artifacts/art_logs",
				},
			],
		})
		expect(audit.events).toHaveLength(1)
		expect(audit.events[0]).toMatchObject({
			type: "artifact.uploaded",
			userId,
			projectId: "proj_123",
			runId: "run_123",
			metadata: {
				name: "logs.txt",
				uri: "sando://artifacts/art_logs",
				private: true,
			},
		})
	})

	it("validates artifact metadata create input", async () => {
		const app = createHostedApp({
			currentUser: () => ({ userId }),
			now: () => fixedNow,
		})

		const response = await app.request(
			"/v1/runs/run_123/artifacts",
			jsonRequest({
				projectId: "run_123",
				name: "",
				uri: "http://example.test/artifact",
				path: "",
				private: false,
			}),
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({
			error: {
				code: "VALIDATION_FAILED",
				message: "Invalid create artifact metadata input.",
				details: {
					issues: [
						{ path: "$.projectId", message: "Expected a project ID." },
						{ path: "$.name", message: "Expected a non-empty string." },
						{ path: "$.uri", message: "Expected a sando URI." },
						{ path: "$.path", message: "Expected a non-empty string." },
						{ path: "$.private", message: "Expected a private artifact." },
					],
				},
			},
		})
	})

	it("requires authentication to list run artifacts", async () => {
		const app = createHostedApp()

		const response = await app.request("/v1/runs/run_123/artifacts")

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({
			error: {
				code: "UNAUTHORIZED",
				message: "Authentication required.",
			},
		})
	})

	it("lists artifacts for the current user and run", async () => {
		const app = createHostedApp({
			artifactRepository: createMemoryArtifactRepository({
				artifacts: [
					{ userId, artifact },
					{
						userId,
						artifact: {
							...artifact,
							id: asId("artifact", "art_other_run"),
							runId: asId("run", "run_other"),
						},
					},
					{ userId: otherUserId, artifact },
				],
			}),
			currentUser: () => ({ userId }),
		})

		const response = await app.request("/v1/runs/run_123/artifacts")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			artifacts: [
				{
					id: "art_123",
					runId: "run_123",
					projectId: "proj_123",
					name: "changed-files.txt",
					uri: "sando://artifacts/art_123",
					path: "/artifacts/changed-files.txt",
					contentType: "text/plain",
					sizeBytes: 128,
					storageKey: "store_123",
					private: true,
					createdAt: "2026-06-14T18:00:00.000Z",
				},
			],
		})
	})

	it("returns an empty list when no artifacts are visible to the current user", async () => {
		const app = createHostedApp({
			artifactRepository: createMemoryArtifactRepository({
				artifacts: [{ userId: otherUserId, artifact }],
			}),
			currentUser: () => ({ userId }),
		})

		const response = await app.request("/v1/runs/run_123/artifacts")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ artifacts: [] })
	})

	it("rejects malformed run IDs", async () => {
		const app = createHostedApp({
			currentUser: () => ({ userId }),
		})

		const response = await app.request("/v1/runs/not-a-run/artifacts")

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: {
				code: "VALIDATION_FAILED",
				message: "Invalid run ID.",
				details: {
					issues: [{ path: "$.runId", message: "Expected a run ID." }],
				},
			},
		})
	})
})

function createArtifactBody() {
	return {
		projectId: "proj_123",
		name: "logs.txt",
		uri: "sando://artifacts/art_logs",
		path: "sando://artifacts/art_logs",
		contentType: "text/plain",
		sizeBytes: 5,
		private: true,
	}
}

function jsonRequest(body: unknown): RequestInit {
	return {
		method: "POST",
		body: JSON.stringify(body),
		headers: { "content-type": "application/json" },
	}
}

function recordingAuditRepository(): {
	readonly events: AppendAuditEventCommand[]
	readonly repository: AuditEventRepository
} {
	const events: AppendAuditEventCommand[] = []

	return {
		events,
		repository: {
			appendAuditEvent(input) {
				events.push(input)

				return {
					auditEvent: {
						id: asId("auditEvent", `audit_${events.length}`),
						type: input.type,
						userId: input.userId,
						...(input.projectId === undefined ? {} : { projectId: input.projectId }),
						...(input.hostId === undefined ? {} : { hostId: input.hostId }),
						...(input.agentId === undefined ? {} : { agentId: input.agentId }),
						...(input.grantId === undefined ? {} : { grantId: input.grantId }),
						...(input.runId === undefined ? {} : { runId: input.runId }),
						timestamp: input.now.toISOString(),
						metadata: input.metadata,
					} satisfies AuditEventRecord,
				}
			},
		},
	}
}
