import { describe, expect, it } from "vitest"

import { asId } from "@sando/shared"

import { createMemoryArtifactRepository } from "./artifacts.js"
import { createHostedApp } from "./index.js"

const userId = asId("user", "user_123")
const otherUserId = asId("user", "user_456")
const artifact = {
	id: asId("artifact", "art_123"),
	runId: asId("run", "run_123"),
	projectId: asId("project", "proj_123"),
	name: "changed-files.txt",
	path: "/artifacts/changed-files.txt",
	contentType: "text/plain",
	sizeBytes: 128,
	storageKey: "store_123",
	private: true as const,
	createdAt: "2026-06-14T18:00:00.000Z",
}

describe("artifact API routes", () => {
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
