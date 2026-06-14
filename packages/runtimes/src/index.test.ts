import { describe, expect, it } from "vitest"

import {
	defaultNodeTsPodmanImage,
	ensurePodmanImage,
	type PodmanCommandOptions,
	type PodmanCommandResult,
	type PodmanCommandRunner,
} from "./index.js"
import { err, sandoError, type Result } from "@sando/shared"

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
