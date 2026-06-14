import { describe, expect, it } from "vitest"

import {
	defaultNodeTsPodmanImage,
	ensurePodmanImage,
	PodmanRuntime,
	type PodmanCommandOptions,
	type PodmanCommandResult,
	type PodmanCommandRunner,
	type SandboxHandle,
} from "./index.js"
import { asId, err, sandoError, type Result } from "@sando/shared"

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

	it("runs a command in an existing Podman sandbox", async () => {
		const runner = fakePodmanRunner([{ exitCode: 2, stdout: "out", stderr: "err" }])
		const runtime = new PodmanRuntime({ commandRunner: runner.run })
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

function podmanHandle(): SandboxHandle {
	return {
		id: "container-id",
		runtime: "podman",
		runId: asId("run", "run_123"),
		metadata: {
			name: "sandhost-run-run_123",
		},
	}
}

function callRecord(
	command: string,
	args: readonly string[],
	options: PodmanCommandOptions | undefined,
): FakePodmanCall {
	if (options === undefined || options.cwd === undefined) {
		return { command, args: [...args] }
	}

	return {
		command,
		args: [...args],
		options: { cwd: options.cwd },
	}
}
