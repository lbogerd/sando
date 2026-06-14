import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { afterEach, describe, expect, it } from "vitest"

import { defaultSandoPolicy } from "@sando/shared"

import { findProjectRoot, loadProjectPolicy, projectPolicyFilePath } from "./index.js"

const tempRoots: string[] = []

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

describe("findProjectRoot", () => {
	it("detects an explicit sandhost policy root", async () => {
		const root = await tempProject()
		await mkdir(join(root, ".sandhost"), { recursive: true })
		await writeFile(join(root, ".sandhost", "policy.json"), "{}")

		await expect(findProjectRoot({ startPath: root })).resolves.toEqual({
			ok: true,
			value: { path: root, marker: ".sandhost/policy.json" },
		})
	})

	it("walks upward from a file and prefers the git root over nested packages", async () => {
		const root = await tempProject()
		const packageRoot = join(root, "packages", "app")
		const sourceFile = join(packageRoot, "src", "index.ts")

		await mkdir(join(root, ".git"), { recursive: true })
		await mkdir(join(packageRoot, "src"), { recursive: true })
		await writeFile(join(packageRoot, "package.json"), "{}")
		await writeFile(sourceFile, "export const value = 1\n")

		await expect(findProjectRoot({ startPath: sourceFile })).resolves.toEqual({
			ok: true,
			value: { path: root, marker: ".git" },
		})
	})

	it("detects a pnpm workspace root when no git marker exists", async () => {
		const root = await tempProject()
		const packageRoot = join(root, "apps", "web")

		await mkdir(packageRoot, { recursive: true })
		await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n")
		await writeFile(join(packageRoot, "package.json"), "{}")

		await expect(findProjectRoot({ startPath: packageRoot })).resolves.toEqual({
			ok: true,
			value: { path: root, marker: "pnpm-workspace.yaml" },
		})
	})

	it("falls back to the nearest package.json when no stronger marker exists", async () => {
		const root = await tempProject()
		const packageRoot = join(root, "standalone")
		const nested = join(packageRoot, "src")

		await mkdir(nested, { recursive: true })
		await writeFile(join(packageRoot, "package.json"), "{}")

		await expect(findProjectRoot({ startPath: nested })).resolves.toEqual({
			ok: true,
			value: { path: packageRoot, marker: "package.json" },
		})
	})

	it("returns a not found error when the start path is missing", async () => {
		const root = await tempProject()
		const missing = join(root, "missing")
		const result = await findProjectRoot({ startPath: missing })

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("NOT_FOUND")
			expect(result.error.details).toEqual({ startPath: missing })
		}
	})

	it("returns a not found error when no project marker is present", async () => {
		const root = await tempProject()
		const result = await findProjectRoot({ startPath: root })

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("NOT_FOUND")
			expect(result.error.details).toEqual({
				startPath: root,
				markers: [".sandhost/policy.json", ".git", "pnpm-workspace.yaml", "package.json"],
			})
		}
	})
})

describe("loadProjectPolicy", () => {
	it("loads and validates a sandhost policy from the detected project root", async () => {
		const root = await tempProject()
		const nested = join(root, "packages", "app")
		const policy = {
			...defaultSandoPolicy,
			defaultNetwork: "default",
			maxTimeoutSeconds: 120,
		}

		await mkdir(nested, { recursive: true })
		await writePolicy(root, policy)

		await expect(loadProjectPolicy({ startPath: nested })).resolves.toEqual({
			ok: true,
			value: {
				projectRoot: root,
				path: join(root, projectPolicyFilePath),
				policy,
			},
		})
	})

	it("can load from an explicit project root", async () => {
		const root = await tempProject()
		await writePolicy(root, defaultSandoPolicy)

		await expect(loadProjectPolicy({ projectRoot: root })).resolves.toEqual({
			ok: true,
			value: {
				projectRoot: root,
				path: join(root, projectPolicyFilePath),
				policy: defaultSandoPolicy,
			},
		})
	})

	it("returns a not found error when the policy file is missing", async () => {
		const root = await tempProject()
		const policyPath = join(root, projectPolicyFilePath)

		await mkdir(join(root, ".git"), { recursive: true })

		const result = await loadProjectPolicy({ startPath: root })

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("NOT_FOUND")
			expect(result.error.details).toEqual({ path: policyPath })
		}
	})

	it("returns a validation error for malformed JSON", async () => {
		const root = await tempProject()
		const policyPath = join(root, projectPolicyFilePath)

		await mkdir(join(root, ".sandhost"), { recursive: true })
		await writeFile(policyPath, "{")

		const result = await loadProjectPolicy({ startPath: root })

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("VALIDATION_FAILED")
			expect(result.error.message).toBe("Sandhost policy file contains invalid JSON.")
			expect(result.error.details).toEqual({
				path: policyPath,
				message: expect.any(String),
			})
		}
	})

	it("wraps shared policy validation errors with the policy path", async () => {
		const root = await tempProject()
		const policyPath = join(root, projectPolicyFilePath)

		await writePolicy(root, {
			...defaultSandoPolicy,
			version: 2,
		})

		const result = await loadProjectPolicy({ startPath: root })

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("VALIDATION_FAILED")
			expect(result.error.details).toEqual({ path: policyPath })
			expect(result.error.cause?.details).toEqual({
				issues: [{ path: "$.version", message: "Expected version 1." }],
			})
		}
	})
})

async function tempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "sando-runners-"))
	tempRoots.push(root)
	return root
}

async function writePolicy(root: string, policy: unknown): Promise<void> {
	await mkdir(join(root, ".sandhost"), { recursive: true })
	await writeFile(join(root, projectPolicyFilePath), JSON.stringify(policy, null, 2))
}
