import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { promisify } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

import { defaultSandoPolicy } from "@sando/shared"

import {
	compileEffectivePolicy,
	findProjectRoot,
	loadProjectPolicy,
	projectPolicyFilePath,
	selectArchiveFiles,
} from "./index.js"

const tempRoots: string[] = []
const execFileAsync = promisify(execFile)

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

describe("compileEffectivePolicy", () => {
	it("uses MVP defaults when no narrower policy layer is provided", () => {
		expect(compileEffectivePolicy()).toEqual({
			ok: true,
			value: {
				template: "node-ts",
				allowedTemplates: ["node-ts"],
				runtime: "podman",
				network: "none",
				allowedNetworks: ["none", "default"],
				maxTtlSeconds: 1800,
				maxTimeoutSeconds: 600,
				timeoutSeconds: 600,
				resources: {
					cpu: 2,
					memoryMb: 4096,
				},
				secrets: {
					allow: [],
				},
				artifacts: defaultSandoPolicy.artifacts,
				exclude: defaultSandoPolicy.exclude,
			},
		})
	})

	it("combines system, hosted, local, template, grant, and request constraints", () => {
		expect(
			compileEffectivePolicy({
				hostedProjectPolicy: {
					allowedNetworks: ["none", "default"],
					maxTtlSeconds: 1200,
					maxTimeoutSeconds: 500,
					resources: {
						cpu: 1.5,
						memoryMb: 2048,
					},
					secrets: {
						allow: ["CI_TOKEN", "NPM_TOKEN"],
					},
					artifacts: ["coverage/**", "reports/**"],
					exclude: ["tmp/**"],
				},
				localProjectPolicy: {
					...defaultSandoPolicy,
					defaultNetwork: "default",
					maxTtlSeconds: 900,
					maxTimeoutSeconds: 300,
					resources: {
						cpu: 1,
						memoryMb: 1024,
					},
					secrets: {
						allow: ["CI_TOKEN"],
					},
					artifacts: ["coverage/**", "test-results/**"],
					exclude: [".env", "dist"],
				},
				grantConstraints: {
					allowedNetworks: ["none"],
					maxTtlSeconds: 600,
					maxTimeoutSeconds: 200,
					resources: {
						cpu: 0.5,
						memoryMb: 512,
					},
					secrets: {
						allow: [],
					},
					artifacts: ["coverage/**"],
					exclude: ["private/**"],
				},
				request: {
					command: "pnpm test",
					network: "none",
					timeoutSeconds: 150,
				},
			}),
		).toEqual({
			ok: true,
			value: {
				template: "node-ts",
				allowedTemplates: ["node-ts"],
				runtime: "podman",
				network: "none",
				allowedNetworks: ["none"],
				maxTtlSeconds: 600,
				maxTimeoutSeconds: 200,
				timeoutSeconds: 150,
				resources: {
					cpu: 0.5,
					memoryMb: 512,
				},
				secrets: {
					allow: [],
				},
				artifacts: ["coverage/**"],
				exclude: ["tmp/**", ".env", "dist", "private/**"],
			},
		})
	})

	it("rejects a requested network outside the effective allowed set", () => {
		const result = compileEffectivePolicy({
			grantConstraints: {
				allowedNetworks: ["none"],
			},
			request: {
				command: "pnpm test",
				network: "default",
			},
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("POLICY_VIOLATION")
			expect(result.error.details).toEqual({
				requestedNetwork: "default",
				allowedNetworks: ["none"],
			})
		}
	})

	it("rejects a requested timeout above the effective maximum", () => {
		const result = compileEffectivePolicy({
			localProjectPolicy: {
				...defaultSandoPolicy,
				maxTimeoutSeconds: 120,
			},
			request: {
				command: "pnpm test",
				timeoutSeconds: 121,
			},
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("POLICY_VIOLATION")
			expect(result.error.details).toEqual({
				requestedTimeoutSeconds: 121,
				maxTimeoutSeconds: 120,
			})
		}
	})

	it("rejects incompatible runtime constraints", () => {
		const result = compileEffectivePolicy({
			localProjectPolicy: {
				...defaultSandoPolicy,
				runtime: "docker",
			},
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("POLICY_VIOLATION")
			expect(result.error.details).toEqual({
				runtimes: ["podman", "docker"],
			})
		}
	})

	it("rejects layers with no shared template", () => {
		const result = compileEffectivePolicy({
			localProjectPolicy: {
				...defaultSandoPolicy,
				defaultTemplate: "python",
			},
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("POLICY_VIOLATION")
			expect(result.error.details).toEqual({
				field: "template",
			})
		}
	})
})

describe("selectArchiveFiles", () => {
	it("selects tracked and untracked files using git exclusions", async () => {
		const root = await tempProject()
		await initGitProject(root)
		await mkdir(join(root, "src"), { recursive: true })
		await mkdir(join(root, "ignored-dir"), { recursive: true })
		await writeFile(join(root, ".gitignore"), "*.log\nignored-dir/\n")
		await writeFile(join(root, "src", "tracked.ts"), "export const tracked = true\n")
		await writeFile(join(root, "src", "untracked file.ts"), "export const untracked = true\n")
		await writeFile(join(root, "debug.log"), "ignored\n")
		await writeFile(join(root, "ignored-dir", "generated.txt"), "ignored\n")
		await runGit(root, ["add", ".gitignore", "src/tracked.ts"])

		const result = await selectArchiveFiles({ projectRoot: root })

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({
				projectRoot: root,
				files: [".gitignore", "src/tracked.ts", "src/untracked file.ts"],
			})
		}
	})

	it("detects the project root from a nested start path", async () => {
		const root = await tempProject()
		const nested = join(root, "packages", "app")

		await initGitProject(root)
		await mkdir(nested, { recursive: true })
		await writeFile(join(root, "README.md"), "# test\n")
		await runGit(root, ["add", "README.md"])

		const result = await selectArchiveFiles({ startPath: nested })

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.projectRoot).toBe(root)
			expect(result.value.files).toEqual(["README.md"])
		}
	})

	it("returns a command failure when git cannot list files", async () => {
		const root = await tempProject()
		const result = await selectArchiveFiles({ projectRoot: root })

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("COMMAND_FAILED")
			expect(result.error.details).toEqual({
				command: "git ls-files -z -c -o --exclude-standard",
				cwd: root,
				exitCode: 128,
				errorCode: null,
				stderr: expect.stringContaining("not a git repository"),
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

async function initGitProject(root: string): Promise<void> {
	await runGit(root, ["init"])
}

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
	await execFileAsync("git", [...args], { cwd })
}
