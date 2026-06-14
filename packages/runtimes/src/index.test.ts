import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
	diagnosePodmanEnvironment,
	defaultNodeTsPodmanImage,
	defaultPodmanCommandRunner,
	ensurePodmanImage,
	PodmanRuntime,
	type PodmanCommandOptions,
	type PodmanCommandResult,
	type PodmanCommandRunner,
	type RuntimeResultJson,
	type SandboxRuntime,
	type SandboxHandle,
	withSandboxCleanup,
} from "./index.js"
import { asId, err, ok, sandoError, type Result } from "@sando/shared"

const tempRoots: string[] = []

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

describe("ensurePodmanImage", () => {
	it("returns an existing image without building or pulling", async () => {
		const runner = fakePodmanRunner([{ exitCode: 0, stdout: "", stderr: "" }])

		await expect(
			ensurePodmanImage({
				image: defaultNodeTsPodmanImage,
				source: {
					kind: "build",
					contextPath: "/templates/node-ts",
				},
				commandRunner: runner.run,
			}),
		).resolves.toEqual({
			ok: true,
			value: {
				image: defaultNodeTsPodmanImage,
				action: "existing",
				stdout: "",
				stderr: "",
			},
		})
		expect(runner.calls).toEqual([
			{
				command: "podman",
				args: ["image", "exists", defaultNodeTsPodmanImage],
			},
		])
	})

	it("builds a missing local template image", async () => {
		const runner = fakePodmanRunner([
			{ exitCode: 1, stdout: "", stderr: "" },
			{ exitCode: 0, stdout: "built", stderr: "" },
		])

		const result = await ensurePodmanImage({
			image: defaultNodeTsPodmanImage,
			source: {
				kind: "build",
				contextPath: "/templates/node-ts",
				containerfilePath: "/templates/node-ts/Containerfile",
				buildArgs: {
					ZZZ: "last",
					PNPM_VERSION: "10.30.3",
				},
			},
			commandRunner: runner.run,
		})

		expect(result).toEqual({
			ok: true,
			value: {
				image: defaultNodeTsPodmanImage,
				action: "built",
				stdout: "built",
				stderr: "",
			},
		})
		expect(runner.calls).toEqual([
			{
				command: "podman",
				args: ["image", "exists", defaultNodeTsPodmanImage],
			},
			{
				command: "podman",
				args: [
					"build",
					"--tag",
					defaultNodeTsPodmanImage,
					"--file",
					"/templates/node-ts/Containerfile",
					"--build-arg",
					"PNPM_VERSION=10.30.3",
					"--build-arg",
					"ZZZ=last",
					"/templates/node-ts",
				],
				options: { cwd: "/templates/node-ts" },
			},
		])
	})

	it("pulls a missing remote image", async () => {
		const runner = fakePodmanRunner([
			{ exitCode: 1, stdout: "", stderr: "" },
			{ exitCode: 0, stdout: "pulled", stderr: "" },
		])
		const image = "ghcr.io/sandhost/node-ts:1"

		await expect(
			ensurePodmanImage({
				image,
				source: { kind: "pull" },
				commandRunner: runner.run,
			}),
		).resolves.toEqual({
			ok: true,
			value: {
				image,
				action: "pulled",
				stdout: "pulled",
				stderr: "",
			},
		})
		expect(runner.calls).toEqual([
			{
				command: "podman",
				args: ["image", "exists", image],
			},
			{
				command: "podman",
				args: ["pull", image],
			},
		])
	})

	it("returns a sandbox failure when a build command fails", async () => {
		const runner = fakePodmanRunner([
			{ exitCode: 1, stdout: "", stderr: "" },
			{ exitCode: 125, stdout: "", stderr: "bad Containerfile" },
		])
		const result = await ensurePodmanImage({
			image: defaultNodeTsPodmanImage,
			source: {
				kind: "build",
				contextPath: "/templates/node-ts",
			},
			commandRunner: runner.run,
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("SANDBOX_FAILED")
			expect(result.error.details).toEqual({
				command: "podman",
				args: ["build", "--tag", defaultNodeTsPodmanImage, "/templates/node-ts"],
				exitCode: 125,
				stderr: "bad Containerfile",
				cwd: "/templates/node-ts",
			})
		}
	})

	it("does not build or pull when image inspection fails unexpectedly", async () => {
		const runner = fakePodmanRunner([{ exitCode: 125, stdout: "", stderr: "podman failed" }])
		const result = await ensurePodmanImage({
			image: defaultNodeTsPodmanImage,
			source: {
				kind: "pull",
			},
			commandRunner: runner.run,
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("SANDBOX_FAILED")
			expect(result.error.details).toEqual({
				command: "podman",
				args: ["image", "exists", defaultNodeTsPodmanImage],
				exitCode: 125,
				stderr: "podman failed",
			})
		}
		expect(runner.calls).toHaveLength(1)
	})

	it("returns command runner errors without falling through to build or pull", async () => {
		const runner = fakePodmanRunner([
			err(
				sandoError({
					code: "RUNTIME_UNAVAILABLE",
					message: "Podman executable is not available.",
					details: { command: "podman" },
				}),
			),
		])

		const result = await ensurePodmanImage({
			image: defaultNodeTsPodmanImage,
			source: {
				kind: "pull",
			},
			commandRunner: runner.run,
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("RUNTIME_UNAVAILABLE")
		}
		expect(runner.calls).toHaveLength(1)
	})
})

describe("defaultPodmanCommandRunner", () => {
	it("returns timed-out command results without treating Podman as unavailable", async () => {
		const result = await defaultPodmanCommandRunner(
			process.execPath,
			["-e", "setTimeout(() => {}, 1000)"],
			{ timeoutMs: 20 },
		)

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toMatchObject({
				exitCode: null,
				stdout: "",
				stderr: "",
				timedOut: true,
			})
		}
	})
})

describe("diagnosePodmanEnvironment", () => {
	it("reports WSL and healthy rootless Podman diagnostics", async () => {
		const runner = fakePodmanRunner([
			{ exitCode: 0, stdout: "podman version 5.0.0\n", stderr: "" },
			{
				exitCode: 0,
				stdout: JSON.stringify({
					host: {
						arch: "amd64",
						cgroupManager: "systemd",
						cgroupVersion: "v2",
						os: "linux",
						security: {
							rootless: true,
						},
						serviceIsRemote: false,
					},
					version: {
						Version: "5.0.0",
					},
				}),
				stderr: "",
			},
		])

		await expect(
			diagnosePodmanEnvironment({
				commandRunner: runner.run,
				environment: {
					WSL_DISTRO_NAME: "Ubuntu",
					WSL_INTEROP: "/run/WSL/123_interop",
				},
				platform: "linux",
				osRelease: "5.15.90.1-microsoft-standard-WSL2",
				procVersion: "Linux version 5.15.90.1-microsoft-standard-WSL2",
			}),
		).resolves.toEqual({
			ok: true,
			value: {
				podmanExecutable: "podman",
				wsl: {
					detected: true,
					platform: "linux",
					osRelease: "5.15.90.1-microsoft-standard-WSL2",
					sources: ["WSL_DISTRO_NAME", "WSL_INTEROP", "os.release", "/proc/version"],
					interopAvailable: true,
					distroName: "Ubuntu",
				},
				checks: [
					{
						name: "wsl",
						status: "pass",
						message: "WSL environment detected.",
						details: {
							detected: true,
							platform: "linux",
							osRelease: "5.15.90.1-microsoft-standard-WSL2",
							sources: ["WSL_DISTRO_NAME", "WSL_INTEROP", "os.release", "/proc/version"],
							interopAvailable: true,
							distroName: "Ubuntu",
						},
					},
					{
						name: "podman.executable",
						status: "pass",
						message: "Podman executable is available.",
						details: {
							command: "podman",
							args: ["--version"],
							exitCode: 0,
							stdout: "podman version 5.0.0\n",
							stderr: "",
						},
					},
					{
						name: "podman.info",
						status: "pass",
						message: "Podman info is available.",
						details: {
							rootless: true,
							version: "5.0.0",
							os: "linux",
							arch: "amd64",
							cgroupManager: "systemd",
							cgroupVersion: "v2",
							serviceIsRemote: false,
						},
					},
					{
						name: "podman.rootless",
						status: "pass",
						message: "Podman is running in rootless mode.",
						details: {
							rootless: true,
							version: "5.0.0",
							os: "linux",
							arch: "amd64",
							cgroupManager: "systemd",
							cgroupVersion: "v2",
							serviceIsRemote: false,
						},
					},
				],
			},
		})
		expect(runner.calls).toEqual([
			{
				command: "podman",
				args: ["--version"],
				options: { timeoutMs: 5000 },
			},
			{
				command: "podman",
				args: ["info", "--format", "json"],
				options: { timeoutMs: 5000 },
			},
		])
	})

	it("reports missing Podman without running later probes", async () => {
		const runner = fakePodmanRunner([
			err(
				sandoError({
					code: "RUNTIME_UNAVAILABLE",
					message: "Podman executable is not available.",
					details: { command: "podman" },
				}),
			),
		])

		const result = await diagnosePodmanEnvironment({
			commandRunner: runner.run,
			environment: {},
			platform: "linux",
			osRelease: "6.8.0",
			procVersion: "",
		})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.checks).toEqual([
				{
					name: "wsl",
					status: "pass",
					message: "WSL was not detected; plain Linux hosts can use the same Podman runtime.",
					details: {
						detected: false,
						platform: "linux",
						osRelease: "6.8.0",
						sources: [],
						interopAvailable: false,
					},
				},
				{
					name: "podman.executable",
					status: "fail",
					message: "Podman executable is not available.",
					details: {
						command: "podman",
						args: ["--version"],
						errorCode: "RUNTIME_UNAVAILABLE",
						errorMessage: "Podman executable is not available.",
						errorDetails: { command: "podman" },
					},
				},
			])
		}
		expect(runner.calls).toEqual([
			{
				command: "podman",
				args: ["--version"],
				options: { timeoutMs: 5000 },
			},
		])
	})

	it("warns when Podman is available but rootful", async () => {
		const runner = fakePodmanRunner([
			{ exitCode: 0, stdout: "podman version 5.0.0\n", stderr: "" },
			{
				exitCode: 0,
				stdout: JSON.stringify({
					host: {
						security: {
							rootless: false,
						},
					},
					version: {
						Version: "5.0.0",
					},
				}),
				stderr: "",
			},
		])

		const result = await diagnosePodmanEnvironment({
			commandRunner: runner.run,
			environment: {},
			platform: "linux",
			osRelease: "6.8.0",
			procVersion: "",
		})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.checks.at(-1)).toEqual({
				name: "podman.rootless",
				status: "warn",
				message: "Podman is running rootful; sandhost prefers rootless Podman.",
				details: {
					rootless: false,
					version: "5.0.0",
				},
			})
		}
	})
})

describe("withSandboxCleanup", () => {
	it("destroys the sandbox after successful operations", async () => {
		const runtime = fakeCleanupRuntime(ok(undefined))
		const handle = podmanHandle()
		const result = await withSandboxCleanup(runtime.runtime, handle, async () => ok("done"))

		expect(result).toEqual({ ok: true, value: "done" })
		expect(runtime.destroyed).toEqual([handle])
	})

	it("destroys the sandbox and preserves operation errors", async () => {
		const runtime = fakeCleanupRuntime(ok(undefined))
		const handle = podmanHandle()
		const operationError = sandoError({
			code: "SANDBOX_FAILED",
			message: "Command failed.",
		})
		const result = await withSandboxCleanup(runtime.runtime, handle, async () =>
			err(operationError),
		)

		expect(result).toEqual({ ok: false, error: operationError })
		expect(runtime.destroyed).toEqual([handle])
	})

	it("returns cleanup failures after successful operations", async () => {
		const cleanupError = sandoError({
			code: "SANDBOX_FAILED",
			message: "Cleanup failed.",
		})
		const runtime = fakeCleanupRuntime(err(cleanupError))
		const result = await withSandboxCleanup(runtime.runtime, podmanHandle(), async () => ok("done"))

		expect(result).toEqual({ ok: false, error: cleanupError })
	})

	it("destroys the sandbox when operations throw without hiding the thrown error", async () => {
		const runtime = fakeCleanupRuntime(ok(undefined))
		const handle = podmanHandle()

		await expect(
			withSandboxCleanup(runtime.runtime, handle, async () => {
				throw new Error("boom")
			}),
		).rejects.toThrow("boom")
		expect(runtime.destroyed).toEqual([handle])
	})
})

describe("PodmanRuntime", () => {
	it("creates and starts a Podman sandbox", async () => {
		const runner = fakePodmanRunner([
			{ exitCode: 0, stdout: "", stderr: "" },
			{ exitCode: 0, stdout: "container-id\n", stderr: "" },
			{ exitCode: 0, stdout: "started\n", stderr: "" },
		])
		const runtime = new PodmanRuntime({
			imageSource: { kind: "pull" },
			commandRunner: runner.run,
		})
		const runId = asId("run", "run_123")

		await expect(
			runtime.createSandbox({
				runId,
				template: "node-ts",
				runtime: "podman",
				network: "none",
				resources: {
					cpu: 2,
					memoryMb: 4096,
				},
				timeoutSeconds: 600,
				environment: {
					FOO: "bar",
				},
			}),
		).resolves.toEqual({
			ok: true,
			value: {
				id: "container-id",
				runtime: "podman",
				runId,
				metadata: {
					artifactDir: "/artifacts",
					image: defaultNodeTsPodmanImage,
					name: "sandhost-run-run_123",
					network: "none",
					resources: {
						cpu: 2,
						memoryMb: 4096,
					},
					timeoutSeconds: 600,
					workdir: "/workspace",
				},
			},
		})
		expect(runner.calls).toEqual([
			{
				command: "podman",
				args: ["image", "exists", defaultNodeTsPodmanImage],
			},
			{
				command: "podman",
				args: [
					"create",
					"--name",
					"sandhost-run-run_123",
					"--network",
					"none",
					"--cpus",
					"2",
					"--memory",
					"4096m",
					"--workdir",
					"/workspace",
					"--env",
					"FOO=bar",
					"--env",
					"SANDHOST_ARTIFACTS=/artifacts",
					"--env",
					"SANDHOST_WORKSPACE=/workspace",
					defaultNodeTsPodmanImage,
					"sleep",
					"infinity",
				],
			},
			{
				command: "podman",
				args: ["start", "sandhost-run-run_123"],
			},
		])
	})

	it("creates default-network sandboxes without overriding Podman's default network", async () => {
		const runner = fakePodmanRunner([
			{ exitCode: 0, stdout: "container-id\n", stderr: "" },
			{ exitCode: 0, stdout: "started\n", stderr: "" },
		])
		const runtime = new PodmanRuntime({ commandRunner: runner.run })
		const result = await runtime.createSandbox({
			runId: asId("run", "run_123"),
			template: "node-ts",
			runtime: "podman",
			network: "default",
			resources: {
				cpu: 1.5,
				memoryMb: 512,
			},
			timeoutSeconds: 600,
		})

		expect(result.ok).toBe(true)
		expect(runner.calls[0]).toEqual({
			command: "podman",
			args: [
				"create",
				"--name",
				"sandhost-run-run_123",
				"--cpus",
				"1.5",
				"--memory",
				"512m",
				"--workdir",
				"/workspace",
				"--env",
				"SANDHOST_ARTIFACTS=/artifacts",
				"--env",
				"SANDHOST_WORKSPACE=/workspace",
				defaultNodeTsPodmanImage,
				"sleep",
				"infinity",
			],
		})
		if (result.ok) {
			expect(result.value.metadata).toMatchObject({
				network: "default",
				resources: {
					cpu: 1.5,
					memoryMb: 512,
				},
				timeoutSeconds: 600,
			})
		}
	})

	it("returns a sandbox failure when create fails", async () => {
		const runner = fakePodmanRunner([
			{ exitCode: 0, stdout: "", stderr: "" },
			{ exitCode: 125, stdout: "", stderr: "bad create" },
		])
		const runtime = new PodmanRuntime({
			imageSource: { kind: "pull" },
			commandRunner: runner.run,
		})
		const result = await runtime.createSandbox({
			runId: asId("run", "run_123"),
			template: "node-ts",
			runtime: "podman",
			network: "none",
			resources: {
				cpu: 2,
				memoryMb: 4096,
			},
			timeoutSeconds: 600,
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("SANDBOX_FAILED")
			expect(result.error.details).toEqual({
				command: "podman",
				args: [
					"create",
					"--name",
					"sandhost-run-run_123",
					"--network",
					"none",
					"--cpus",
					"2",
					"--memory",
					"4096m",
					"--workdir",
					"/workspace",
					"--env",
					"SANDHOST_ARTIFACTS=/artifacts",
					"--env",
					"SANDHOST_WORKSPACE=/workspace",
					defaultNodeTsPodmanImage,
					"sleep",
					"infinity",
				],
				exitCode: 125,
				stderr: "bad create",
			})
		}
	})

	it("destroys a created Podman sandbox when start fails", async () => {
		const runner = fakePodmanRunner([
			{ exitCode: 0, stdout: "container-id\n", stderr: "" },
			{ exitCode: 125, stdout: "", stderr: "bad start" },
			{ exitCode: 0, stdout: "", stderr: "" },
		])
		const runtime = new PodmanRuntime({ commandRunner: runner.run })
		const result = await runtime.createSandbox({
			runId: asId("run", "run_123"),
			template: "node-ts",
			runtime: "podman",
			network: "none",
			resources: {
				cpu: 2,
				memoryMb: 4096,
			},
			timeoutSeconds: 600,
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("SANDBOX_FAILED")
			expect(result.error.details).toMatchObject({
				command: "podman",
				args: ["start", "sandhost-run-run_123"],
				exitCode: 125,
				stderr: "bad start",
			})
		}
		expect(runner.calls.at(-1)).toEqual({
			command: "podman",
			args: ["rm", "--force", "sandhost-run-run_123"],
		})
	})

	it("runs a command in an existing Podman sandbox", async () => {
		const runner = fakePodmanRunner([{ exitCode: 2, stdout: "out", stderr: "err" }])
		const runtime = new PodmanRuntime({
			commandRunner: runner.run,
			runsRootPath: await tempRunsRoot(),
		})
		const result = await runtime.runCommand(podmanHandle(), {
			command: "pnpm test",
			cwd: "/workspace/packages/app",
			env: {
				NODE_ENV: "test",
			},
		})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toMatchObject({
				status: "failed",
				exitCode: 2,
				stdout: "out",
				stderr: "err",
				logs: "outerr",
			})
			expect(result.value.startedAt).toEqual(expect.any(String))
			expect(result.value.finishedAt).toEqual(expect.any(String))
			expect(result.value.durationMs).toEqual(expect.any(Number))
		}
		expect(runner.calls).toEqual([
			{
				command: "podman",
				args: [
					"exec",
					"--env",
					"NODE_ENV=test",
					"--workdir",
					"/workspace/packages/app",
					"sandhost-run-run_123",
					"/sandhost/runner/run.sh",
					"bash",
					"-lc",
					"pnpm test",
				],
			},
		])
	})

	it("uses the sandbox timeout when running commands", async () => {
		const runner = fakePodmanRunner([{ exitCode: 0, stdout: "ok", stderr: "" }])
		const runtime = new PodmanRuntime({
			commandRunner: runner.run,
			runsRootPath: await tempRunsRoot(),
		})
		const result = await runtime.runCommand(podmanHandle({ timeoutSeconds: 600 }), {
			command: "pnpm test",
		})

		expect(result.ok).toBe(true)
		expect(runner.calls).toEqual([
			{
				command: "podman",
				args: [
					"exec",
					"sandhost-run-run_123",
					"/sandhost/runner/run.sh",
					"bash",
					"-lc",
					"pnpm test",
				],
				options: { timeoutMs: 600000 },
			},
		])
	})

	it("uses a command timeout override and reports timed-out commands", async () => {
		const runner = fakePodmanRunner([
			{ exitCode: null, stdout: "partial", stderr: "", timedOut: true, signal: "SIGTERM" },
		])
		const runtime = new PodmanRuntime({
			commandRunner: runner.run,
			runsRootPath: await tempRunsRoot(),
		})
		const result = await runtime.runCommand(podmanHandle({ timeoutSeconds: 600 }), {
			command: "sleep 999",
			timeoutSeconds: 5,
		})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toMatchObject({
				status: "timed_out",
				exitCode: null,
				stdout: "partial",
				stderr: "",
				logs: "partial",
			})
		}
		expect(runner.calls).toEqual([
			{
				command: "podman",
				args: [
					"exec",
					"sandhost-run-run_123",
					"/sandhost/runner/run.sh",
					"bash",
					"-lc",
					"sleep 999",
				],
				options: { timeoutMs: 5000 },
			},
		])
	})

	it("writes host result.json and keeps it when artifacts are collected", async () => {
		const runsRootPath = await tempRunsRoot()
		const runRootPath = join(runsRootPath, "run_123")
		const calls: FakePodmanCall[] = []
		const run: PodmanCommandRunner = async (command, args, options) => {
			calls.push(callRecord(command, args, options))

			if (args[0] === "cp") {
				await writeArtifactFiles(runRootPath)
				return {
					ok: true,
					value: { exitCode: 0, stdout: "", stderr: "" },
				}
			}

			return {
				ok: true,
				value: { exitCode: 2, stdout: "out", stderr: "err" },
			}
		}
		const runtime = new PodmanRuntime({ commandRunner: run, runsRootPath })
		const handle = podmanHandle({ network: "none" })
		const result = await runtime.runCommand(handle, {
			command: "pnpm test",
		})

		expect(result.ok).toBe(true)
		await expect(readResultJson(runRootPath)).resolves.toMatchObject({
			runId: "run_123",
			runtime: "podman",
			command: "pnpm test",
			status: "failed",
			exitCode: 2,
			network: "none",
			artifacts: {
				logs: "logs.txt",
				stdout: "stdout.txt",
				stderr: "stderr.txt",
				diff: "diff.patch",
				changedFiles: "changed-files.txt",
			},
		})

		const collected = await runtime.collectArtifacts(handle)

		expect(collected.ok).toBe(true)
		if (collected.ok) {
			expect(collected.value.resultPath).toBe(join(runRootPath, "result.json"))
		}
		await expect(readResultJson(runRootPath)).resolves.toMatchObject({
			command: "pnpm test",
			status: "failed",
			exitCode: 2,
		})
		expect(calls.map((call) => call.args[0])).toEqual(["exec", "cp"])
	})

	it("copies Podman artifacts into the local run directory", async () => {
		const runsRootPath = await tempRunsRoot()
		const runRootPath = join(runsRootPath, "run_123")
		const calls: FakePodmanCall[] = []
		const run: PodmanCommandRunner = async (command, args, options) => {
			calls.push(callRecord(command, args, options))
			await writeArtifactFiles(runRootPath)
			return {
				ok: true,
				value: { exitCode: 0, stdout: "", stderr: "" },
			}
		}
		const runtime = new PodmanRuntime({ commandRunner: run, runsRootPath })

		await mkdir(runRootPath, { recursive: true })
		await writeFile(join(runRootPath, "stale.txt"), "old")

		const result = await runtime.collectArtifacts(podmanHandle())

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toMatchObject({
				rootPath: runRootPath,
				resultPath: join(runRootPath, "result.json"),
				logsPath: join(runRootPath, "logs.txt"),
				diffPath: join(runRootPath, "diff.patch"),
				changedFilesPath: join(runRootPath, "changed-files.txt"),
			})
			expect(result.value.artifacts.map((artifact) => artifact.name)).toEqual([
				"changed-files.txt",
				"coverage/report.txt",
				"diff.patch",
				"logs.txt",
				"result.json",
				"stderr.txt",
				"stdout.txt",
			])
			expect(result.value.artifacts).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "logs.txt",
						path: join(runRootPath, "logs.txt"),
						contentType: "text/plain",
						sizeBytes: 4,
					}),
					expect.objectContaining({
						name: "result.json",
						path: join(runRootPath, "result.json"),
						contentType: "application/json",
					}),
					expect.objectContaining({
						name: "coverage/report.txt",
						path: join(runRootPath, "coverage", "report.txt"),
						contentType: "text/plain",
					}),
				]),
			)
		}
		expect(calls).toEqual([
			{
				command: "podman",
				args: ["cp", "sandhost-run-run_123:/artifacts/.", runRootPath],
			},
		])
	})

	it("returns a sandbox failure when artifact copy fails", async () => {
		const runsRootPath = await tempRunsRoot()
		const runRootPath = join(runsRootPath, "run_123")
		const runner = fakePodmanRunner([{ exitCode: 125, stdout: "", stderr: "copy failed" }])
		const runtime = new PodmanRuntime({ commandRunner: runner.run, runsRootPath })
		const result = await runtime.collectArtifacts(
			podmanHandle({ artifactDir: "/custom-artifacts" }),
		)

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe("SANDBOX_FAILED")
			expect(result.error.details).toEqual({
				command: "podman",
				args: ["cp", "sandhost-run-run_123:/custom-artifacts/.", runRootPath],
				exitCode: 125,
				stderr: "copy failed",
			})
		}
	})

	it("destroys a Podman sandbox", async () => {
		const runner = fakePodmanRunner([{ exitCode: 0, stdout: "", stderr: "" }])
		const runtime = new PodmanRuntime({ commandRunner: runner.run })

		await expect(runtime.destroySandbox(podmanHandle())).resolves.toEqual({
			ok: true,
			value: undefined,
		})
		expect(runner.calls).toEqual([
			{
				command: "podman",
				args: ["rm", "--force", "sandhost-run-run_123"],
			},
		])
	})
})

type FakePodmanCall = {
	readonly command: string
	readonly args: readonly string[]
	readonly options?: PodmanCommandOptions
}

function fakePodmanRunner(results: Array<PodmanCommandResult | Result<PodmanCommandResult>>): {
	calls: FakePodmanCall[]
	run: PodmanCommandRunner
} {
	const calls: FakePodmanCall[] = []

	return {
		calls,
		run: async (command, args, options) => {
			calls.push(callRecord(command, args, options))

			const result = results.shift()

			if (result === undefined) {
				throw new Error("No fake Podman result queued.")
			}

			if ("ok" in result) {
				return result
			}

			return {
				ok: true,
				value: result,
			}
		},
	}
}

function fakeCleanupRuntime(destroyResult: Result<void>): {
	destroyed: SandboxHandle[]
	runtime: SandboxRuntime
} {
	const destroyed: SandboxHandle[] = []

	return {
		destroyed,
		runtime: {
			kind: "podman",
			createSandbox: async () => {
				throw new Error("createSandbox is not used by this fake runtime.")
			},
			uploadWorkspace: async () => {
				throw new Error("uploadWorkspace is not used by this fake runtime.")
			},
			runCommand: async () => {
				throw new Error("runCommand is not used by this fake runtime.")
			},
			collectArtifacts: async () => {
				throw new Error("collectArtifacts is not used by this fake runtime.")
			},
			destroySandbox: async (handle) => {
				destroyed.push(handle)
				return destroyResult
			},
		},
	}
}

async function tempRunsRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "sando-runtimes-"))
	tempRoots.push(root)
	return join(root, ".sandhost", "runs")
}

async function writeArtifactFiles(rootPath: string): Promise<void> {
	await mkdir(join(rootPath, "coverage"), { recursive: true })
	await writeFile(join(rootPath, "changed-files.txt"), " M src/index.ts\n")
	await writeFile(join(rootPath, "coverage", "report.txt"), "coverage")
	await writeFile(join(rootPath, "diff.patch"), "diff")
	await writeFile(join(rootPath, "logs.txt"), "logs")
	await writeFile(join(rootPath, "result.json"), "{}")
	await writeFile(join(rootPath, "stderr.txt"), "err")
	await writeFile(join(rootPath, "stdout.txt"), "out")
}

async function readResultJson(rootPath: string): Promise<RuntimeResultJson> {
	return JSON.parse(await readFile(join(rootPath, "result.json"), "utf8")) as RuntimeResultJson
}

function podmanHandle(
	options: {
		readonly timeoutSeconds?: number
		readonly artifactDir?: string
		readonly network?: "none" | "default"
	} = {},
): SandboxHandle {
	const metadata: Record<string, string | number> = {
		name: "sandhost-run-run_123",
	}

	if (options.network !== undefined) {
		metadata.network = options.network
	}

	if (options.artifactDir !== undefined) {
		metadata.artifactDir = options.artifactDir
	}

	if (options.timeoutSeconds !== undefined) {
		metadata.timeoutSeconds = options.timeoutSeconds
	}

	return {
		id: "container-id",
		runtime: "podman",
		runId: asId("run", "run_123"),
		metadata,
	}
}

function callRecord(
	command: string,
	args: readonly string[],
	options: PodmanCommandOptions | undefined,
): FakePodmanCall {
	if (options === undefined || (options.cwd === undefined && options.timeoutMs === undefined)) {
		return { command, args: [...args] }
	}

	const recordedOptions: { cwd?: string; timeoutMs?: number } = {}

	if (options.cwd !== undefined) {
		recordedOptions.cwd = options.cwd
	}

	if (options.timeoutMs !== undefined) {
		recordedOptions.timeoutMs = options.timeoutMs
	}

	return {
		command,
		args: [...args],
		options: recordedOptions,
	}
}
