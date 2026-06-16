import { execFile } from "node:child_process"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

import {
	asId,
	defaultSandoPolicy,
	err,
	ok,
	runProjectCommandHash,
	sandoError,
	type CommandHash,
	type GrantRecord,
} from "@sando/shared"
import type { ArtifactBundle, SandboxHandle, SandboxRuntime } from "@sando/runtimes"

import {
	type AgentAuthority,
	artifactIdForRunArtifact,
	compileEffectivePolicy,
	filterArchiveFiles,
	filterSensitiveArchiveFiles,
	findProjectRoot,
	isSensitiveArchiveFilePath,
	loadProjectPolicy,
	projectPolicyFilePath,
	readRunArtifact,
	readRunDiff,
	readRunLogs,
	runProjectCommand,
	selectArchiveFiles,
} from "./index.js"

const tempRoots: string[] = []
const execFileAsync = promisify(execFile)
const runnersPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const nodeTsBasicFixtureRoot = join(runnersPackageRoot, "fixtures", "node-ts-basic")

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

describe("findProjectRoot", () => {
	it("detects an explicit sando policy root", async () => {
		const root = await tempProject()
		await mkdir(join(root, ".sando"), { recursive: true })
		await writeFile(join(root, ".sando", "policy.json"), "{}")

		await expect(findProjectRoot({ startPath: root })).resolves.toEqual({
			ok: true,
			value: { path: root, marker: ".sando/policy.json" },
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
				markers: [".sando/policy.json", ".git", "pnpm-workspace.yaml", "package.json"],
			})
		}
	})
})

describe("loadProjectPolicy", () => {
	it("loads and validates a sando policy from the detected project root", async () => {
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

		await mkdir(join(root, ".sando"), { recursive: true })
		await writeFile(policyPath, "{")

		const result = await loadProjectPolicy({ startPath: root })

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("VALIDATION_FAILED")
			expect(result.error.message).toBe("Sando policy file contains invalid JSON.")
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

	it("filters hardcoded sensitive files after git selection", async () => {
		const root = await tempProject()

		await initGitProject(root)
		await mkdir(join(root, "config"), { recursive: true })
		await mkdir(join(root, ".ssh"), { recursive: true })
		await mkdir(join(root, ".aws"), { recursive: true })
		await mkdir(join(root, "certs"), { recursive: true })
		await writeFile(join(root, "README.md"), "# safe\n")
		await writeFile(join(root, ".env"), "TOKEN=secret\n")
		await writeFile(join(root, "config", ".env.local"), "TOKEN=secret\n")
		await writeFile(join(root, ".npmrc"), "//registry.npmjs.org/:_authToken=secret\n")
		await writeFile(join(root, ".ssh", "id_ed25519"), "secret\n")
		await writeFile(join(root, ".aws", "credentials"), "secret\n")
		await writeFile(join(root, "certs", "client.pem"), "secret\n")
		await runGit(root, ["add", "README.md", ".env", ".npmrc", ".ssh/id_ed25519"])

		const result = await selectArchiveFiles({ projectRoot: root })

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.files).toEqual(["README.md"])
		}
	})

	it("filters policy exclude patterns after git selection", () => {
		expect(
			filterArchiveFiles(
				[
					".sando/policy.json",
					".sando/runs/run_fixture/result.json",
					"debug.log",
					"dist/output.js",
					"notes/todo.md",
					"packages/app/dist/output.js",
				],
				[".sando/runs", "dist"],
			),
		).toEqual([".sando/policy.json", "debug.log", "notes/todo.md"])
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

describe("integration fixture repo", () => {
	it("loads and compiles policy from the node-ts fixture", async () => {
		const root = await tempFixtureProject()
		const sourcePath = join(root, "src", "math.ts")

		await expect(findProjectRoot({ startPath: sourcePath })).resolves.toEqual({
			ok: true,
			value: { path: root, marker: ".sando/policy.json" },
		})

		const policyResult = await loadProjectPolicy({ startPath: sourcePath })

		expect(policyResult.ok).toBe(true)
		if (!policyResult.ok) {
			return
		}

		expect(policyResult.value).toEqual({
			projectRoot: root,
			path: join(root, projectPolicyFilePath),
			policy: {
				version: 1,
				defaultTemplate: "node-ts",
				runtime: "podman",
				defaultNetwork: "none",
				allowedNetworks: ["none", "default"],
				maxTtlSeconds: 900,
				maxTimeoutSeconds: 120,
				resources: {
					cpu: 1,
					memoryMb: 512,
				},
				secrets: {
					allow: [],
				},
				artifacts: ["coverage/**", "test-results/**", "*.patch"],
				exclude: [
					".git",
					"node_modules",
					".env",
					".env.*",
					"dist",
					"build",
					"coverage",
					".sando/runs",
					"ignored-dir",
				],
			},
		})

		expect(
			compileEffectivePolicy({
				localProjectPolicy: policyResult.value.policy,
				request: {
					command: "pnpm test",
					timeoutSeconds: 90,
				},
			}),
		).toEqual({
			ok: true,
			value: {
				template: "node-ts",
				allowedTemplates: ["node-ts"],
				runtime: "podman",
				network: "none",
				allowedNetworks: ["none", "default"],
				maxTtlSeconds: 900,
				maxTimeoutSeconds: 120,
				timeoutSeconds: 90,
				resources: {
					cpu: 1,
					memoryMb: 512,
				},
				secrets: {
					allow: [],
				},
				artifacts: ["coverage/**", "test-results/**", "*.patch"],
				exclude: [
					".git",
					"node_modules",
					".env",
					".env.*",
					"dist",
					"build",
					"coverage",
					".sando/runs",
					"ignored-dir",
				],
			},
		})
	})

	it("selects sandboxable files from the node-ts fixture repository", async () => {
		const root = await fixtureGitProject()

		await addFixtureWorkingTreeFiles(root)

		const result = await selectArchiveFiles({ startPath: join(root, "test") })

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({
				projectRoot: root,
				files: [
					".gitignore",
					".sando/policy.json",
					"README.md",
					"notes/todo.md",
					"package.json",
					"src/math.ts",
					"test/math.test.js",
					"tsconfig.json",
				],
			})
		}
	})

	it("keeps the node-ts fixture test script runnable", async () => {
		const root = await tempFixtureProject()
		const { stdout } = await execFileAsync("pnpm", ["test"], { cwd: root })

		expect(stdout).toContain("fixture exposes a TypeScript entrypoint")
	})
})

describe("runProjectCommand", () => {
	it("runs a project command through an injected runtime and returns MCP refs", async () => {
		const root = await fixtureGitProject()
		await addFixtureWorkingTreeFiles(root)
		const runId = "run_test"
		const artifactRoot = join(await tempProject(), "artifacts")
		const artifacts = await writeRunArtifactBundle(artifactRoot)
		const calls: string[] = []
		const runtime: SandboxRuntime = {
			kind: "podman",
			createSandbox: async (input) => {
				calls.push("create")
				expect(input).toMatchObject({
					runId: asId("run", runId),
					template: "node-ts",
					runtime: "podman",
					network: "none",
					resources: {
						cpu: 1,
						memoryMb: 512,
					},
					timeoutSeconds: 120,
				})

				return ok({
					id: "sandbox-id",
					runtime: "podman",
					runId: input.runId,
					metadata: {
						name: "sando-run-run_test",
					},
				})
			},
			uploadWorkspace: async (_handle, archive) => {
				calls.push("upload")
				await expect(readFile(join(archive.path, "README.md"), "utf8")).resolves.toContain(
					"runner integration tests",
				)
				await expect(readFile(join(archive.path, "notes", "todo.md"), "utf8")).resolves.toBe(
					"safe untracked note\n",
				)
				await expect(readFile(join(archive.path, ".env"), "utf8")).rejects.toMatchObject({
					code: "ENOENT",
				})
				return ok(undefined)
			},
			runCommand: async (_handle, command) => {
				calls.push("run")
				expect(command).toEqual({
					command: "pnpm test",
					timeoutSeconds: 120,
				})
				return ok({
					status: "succeeded",
					exitCode: 0,
					stdout: "ok\n",
					stderr: "",
					logs: "ok\n",
					startedAt: "2026-06-15T00:00:00.000Z",
					finishedAt: "2026-06-15T00:00:01.250Z",
					durationMs: 1250,
				})
			},
			collectArtifacts: async () => {
				calls.push("collect")
				return ok(artifacts)
			},
			destroySandbox: async (handle: SandboxHandle) => {
				calls.push(`destroy:${handle.id}`)
				return ok(undefined)
			},
		}

		const result = await runProjectCommand(
			{
				command: "pnpm test",
			},
			{
				projectRoot: root,
				runId,
				runtime,
			},
		)

		expect(result.ok).toBe(true)
		if (!result.ok) {
			return
		}

		expect(result.value).toMatchObject({
			runId,
			status: "succeeded",
			exitCode: 0,
			durationMs: 1250,
			command: "pnpm test",
			network: "none",
			summary: "Command succeeded: pnpm test",
			logsRef: "sando://runs/run_test/logs",
			diffRef: "sando://runs/run_test/diff",
			auditRef: "sando://runs/run_test/audit",
		})
		expect(result.value.artifacts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: artifactIdForRunArtifact(runId, "logs.txt"),
					name: "logs.txt",
					uri: `sando://artifacts/${artifactIdForRunArtifact(runId, "logs.txt")}`,
				}),
				expect.objectContaining({
					id: artifactIdForRunArtifact(runId, "diff.patch"),
					name: "diff.patch",
				}),
			]),
		)
		expect(calls).toEqual(["create", "upload", "run", "collect", "destroy:sandbox-id"])
	})

	it("requires hosted authority before local sandbox execution when configured", async () => {
		const root = await fixtureGitProject()
		await addFixtureWorkingTreeFiles(root)
		const seen: unknown[] = []
		const authority: AgentAuthority = {
			async ensureCapability(input) {
				seen.push(input)
				return ok({
					grant: grantRecord(input.commandHash),
				})
			},
		}
		const artifactRoot = join(await tempProject(), "artifacts")
		const artifacts = await writeRunArtifactBundle(artifactRoot)
		const calls: string[] = []
		const runtime = fakeRuntime(calls, artifacts)

		const result = await runProjectCommand(
			{
				command: "pnpm test",
				timeoutSeconds: 90,
			},
			{
				authority,
				projectRoot: root,
				runId: "run_authorized",
				runtime,
			},
		)

		expect(result.ok).toBe(true)
		expect(seen).toEqual([
			{
				capability: "sandbox.run_project_command",
				command: "pnpm test",
				commandHash: runProjectCommandHash({
					command: "pnpm test",
					template: "node-ts",
					runtime: "podman",
					network: "none",
					timeoutSeconds: 90,
				}),
				maxTimeoutSeconds: 120,
				network: "none",
				runtime: "podman",
				template: "node-ts",
				timeoutSeconds: 90,
			},
		])
		expect(calls).toEqual(["create", "upload", "run", "collect", "destroy:sandbox-id"])
	})

	it("does not execute locally when hosted authority denies the capability", async () => {
		const root = await fixtureGitProject()
		await addFixtureWorkingTreeFiles(root)
		const authority: AgentAuthority = {
			async ensureCapability() {
				return err(
					sandoError({
						code: "GRANT_DENIED",
						message: "Grant was denied.",
					}),
				)
			},
		}
		const calls: string[] = []
		const runtime = fakeRuntime(
			calls,
			await writeRunArtifactBundle(join(await tempProject(), "artifacts")),
		)

		const result = await runProjectCommand(
			{
				command: "pnpm test",
			},
			{
				authority,
				projectRoot: root,
				runId: "run_denied",
				runtime,
			},
		)

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("GRANT_DENIED")
			expect(result.error.message).toBe("Grant was denied.")
		}
		expect(calls).toEqual([])
	})

	it("reads local logs, diffs, and artifacts by generated artifact ID", async () => {
		const runsRoot = await tempProject()
		const runRoot = join(runsRoot, "run_read")
		await writeRunArtifactBundle(runRoot)

		await expect(readRunLogs({ runId: "run_read", runsRootPath: runsRoot })).resolves.toEqual({
			ok: true,
			value: "logs\n",
		})
		await expect(readRunDiff({ runId: "run_read", runsRootPath: runsRoot })).resolves.toEqual({
			ok: true,
			value: "diff\n",
		})
		await expect(
			readRunArtifact({
				artifactId: artifactIdForRunArtifact("run_read", "logs.txt"),
				runsRootPath: runsRoot,
			}),
		).resolves.toMatchObject({
			ok: true,
			value: {
				artifact: {
					name: "logs.txt",
				},
				content: "logs\n",
			},
		})
		await expect(
			readRunArtifact({
				artifactId: artifactIdForRunArtifact("run_read", "coverage/report.txt"),
				runsRootPath: runsRoot,
			}),
		).resolves.toMatchObject({
			ok: true,
			value: {
				artifact: {
					name: "coverage/report.txt",
				},
				content: "coverage\n",
			},
		})
	})
})

describe("hardcoded sensitive file exclusions", () => {
	it("matches common secret-bearing archive paths", () => {
		expect(isSensitiveArchiveFilePath(".env")).toBe(true)
		expect(isSensitiveArchiveFilePath("apps/api/.env.production")).toBe(true)
		expect(isSensitiveArchiveFilePath(".npmrc")).toBe(true)
		expect(isSensitiveArchiveFilePath(".ssh/id_rsa")).toBe(true)
		expect(isSensitiveArchiveFilePath("certs/client.key")).toBe(true)
		expect(isSensitiveArchiveFilePath("certs/client.pem")).toBe(true)
		expect(isSensitiveArchiveFilePath(".aws/credentials")).toBe(true)
		expect(isSensitiveArchiveFilePath("users/me/.kube/config")).toBe(true)
	})

	it("leaves ordinary source and docs files selected", () => {
		expect(
			filterSensitiveArchiveFiles([
				"README.md",
				"src/index.ts",
				"docs/env-notes.md",
				"packages/api/src/key-value.ts",
			]),
		).toEqual(["README.md", "src/index.ts", "docs/env-notes.md", "packages/api/src/key-value.ts"])
	})
})

async function tempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "sando-runners-"))
	tempRoots.push(root)
	return root
}

async function tempFixtureProject(): Promise<string> {
	const tempRoot = await tempProject()
	const fixtureRoot = join(tempRoot, "node-ts-basic")

	await cp(nodeTsBasicFixtureRoot, fixtureRoot, { recursive: true })

	return fixtureRoot
}

async function fixtureGitProject(): Promise<string> {
	const root = await tempFixtureProject()

	await initGitProject(root)
	await runGit(root, ["config", "user.email", "fixture@example.local"])
	await runGit(root, ["config", "user.name", "Fixture"])
	await runGit(root, ["add", "."])
	await runGit(root, ["commit", "-m", "fixture baseline"])

	return root
}

async function addFixtureWorkingTreeFiles(root: string): Promise<void> {
	await mkdir(join(root, "notes"), { recursive: true })
	await mkdir(join(root, "dist"), { recursive: true })
	await mkdir(join(root, "coverage"), { recursive: true })
	await mkdir(join(root, "ignored-dir"), { recursive: true })
	await mkdir(join(root, "node_modules", ".cache"), { recursive: true })
	await mkdir(join(root, ".sando", "runs", "run_fixture"), { recursive: true })
	await mkdir(join(root, "certs"), { recursive: true })
	await writeFile(join(root, "notes", "todo.md"), "safe untracked note\n")
	await writeFile(join(root, ".env"), "TOKEN=dummy\n")
	await writeFile(join(root, ".npmrc"), "//registry.example/:_authToken=dummy\n")
	await writeFile(join(root, "certs", "client.key"), "dummy key\n")
	await writeFile(join(root, "dist", "output.js"), "ignored output\n")
	await writeFile(join(root, "coverage", "coverage.json"), "{}\n")
	await writeFile(join(root, "ignored-dir", "generated.txt"), "ignored generated file\n")
	await writeFile(join(root, "node_modules", ".cache", "entry"), "ignored dependency cache\n")
	await writeFile(join(root, ".sando", "runs", "run_fixture", "result.json"), "{}\n")
	await writeFile(join(root, "debug.log"), "ignored log\n")
}

function fakeRuntime(calls: string[], artifacts: ArtifactBundle): SandboxRuntime {
	return {
		kind: "podman",
		createSandbox: async (input) => {
			calls.push("create")

			return ok({
				id: "sandbox-id",
				runtime: "podman",
				runId: input.runId,
				metadata: {
					name: `sando-run-${input.runId}`,
				},
			})
		},
		uploadWorkspace: async () => {
			calls.push("upload")
			return ok(undefined)
		},
		runCommand: async () => {
			calls.push("run")
			return ok({
				status: "succeeded",
				exitCode: 0,
				stdout: "ok\n",
				stderr: "",
				logs: "ok\n",
				startedAt: "2026-06-15T00:00:00.000Z",
				finishedAt: "2026-06-15T00:00:01.250Z",
				durationMs: 1250,
			})
		},
		collectArtifacts: async () => {
			calls.push("collect")
			return ok(artifacts)
		},
		destroySandbox: async (handle) => {
			calls.push(`destroy:${handle.id}`)
			return ok(undefined)
		},
	}
}

function grantRecord(commandHash: string): GrantRecord {
	return {
		id: asId("grant", "grant_authorized"),
		userId: asId("user", "user_123"),
		projectId: asId("project", "proj_123"),
		hostId: asId("host", "host_123"),
		agentId: asId("agent", "agent_123"),
		capabilities: ["sandbox.run_project_command"],
		constraints: {
			command: "pnpm test",
			commandHash: commandHash as CommandHash,
			maxTimeoutSeconds: 120,
			network: "none",
			runtime: "podman",
			template: "node-ts",
			timeoutSeconds: 90,
		},
		scope: "one_shot",
		status: "approved",
		createdAt: "2026-06-14T17:30:00.000Z",
		expiresAt: "2026-06-14T17:40:00.000Z",
		approvedAt: "2026-06-14T17:31:00.000Z",
	}
}

async function writeRunArtifactBundle(rootPath: string): Promise<ArtifactBundle> {
	await mkdir(rootPath, { recursive: true })
	const logsPath = join(rootPath, "logs.txt")
	const stdoutPath = join(rootPath, "stdout.txt")
	const stderrPath = join(rootPath, "stderr.txt")
	const diffPath = join(rootPath, "diff.patch")
	const changedFilesPath = join(rootPath, "changed-files.txt")
	const coveragePath = join(rootPath, "coverage", "report.txt")
	const resultPath = join(rootPath, "result.json")

	await mkdir(dirname(coveragePath), { recursive: true })
	await writeFile(logsPath, "logs\n")
	await writeFile(stdoutPath, "out\n")
	await writeFile(stderrPath, "")
	await writeFile(diffPath, "diff\n")
	await writeFile(changedFilesPath, "")
	await writeFile(coveragePath, "coverage\n")
	await writeFile(resultPath, "{}\n")

	return {
		rootPath,
		logsPath,
		diffPath,
		changedFilesPath,
		resultPath,
		artifacts: [
			{
				name: "changed-files.txt",
				path: changedFilesPath,
				contentType: "text/plain",
				sizeBytes: 0,
			},
			{
				name: "coverage/report.txt",
				path: coveragePath,
				contentType: "text/plain",
				sizeBytes: 9,
			},
			{
				name: "diff.patch",
				path: diffPath,
				contentType: "text/plain",
				sizeBytes: 5,
			},
			{
				name: "logs.txt",
				path: logsPath,
				contentType: "text/plain",
				sizeBytes: 5,
			},
			{
				name: "result.json",
				path: resultPath,
				contentType: "application/json",
				sizeBytes: 3,
			},
			{
				name: "stderr.txt",
				path: stderrPath,
				contentType: "text/plain",
				sizeBytes: 0,
			},
			{
				name: "stdout.txt",
				path: stdoutPath,
				contentType: "text/plain",
				sizeBytes: 4,
			},
		],
	}
}

async function writePolicy(root: string, policy: unknown): Promise<void> {
	await mkdir(join(root, ".sando"), { recursive: true })
	await writeFile(join(root, projectPolicyFilePath), JSON.stringify(policy, null, 2))
}

async function initGitProject(root: string): Promise<void> {
	await runGit(root, ["init"])
}

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
	await execFileAsync("git", [...args], { cwd })
}
